import { useState, useRef } from 'react'
import Plot from 'react-plotly.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play, Download, Plus, Trash2, Upload, X, GitCompare, Dices, Check, Calculator } from 'lucide-react'
import Papa from 'papaparse'
import ResultsTable from '../shared/ResultsTable'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import {
  fitDistributions, fitNonparametric, generateSamples, getSpecCurves,
  compareFolios, calculateMetrics, CalculatorResponse, computeStressStrength, fitSpecialModel,
  fitWeibayes,
  FitResponse, NonparametricResponse, SpecCurvesResponse, CompareResponse,
  StressStrengthResponse, SpecialModelResponse, WeibayesResponse,
} from '../../api/client'
import { useModuleState, useUnits } from '../../store/project'
import NumberField from '../shared/NumberField'
import {
  computeSalientPoints, salientTrace, suspensionTrace, CurveData, CurveKey,
} from './plotOverlays'

const ALL_DISTS = [
  'Weibull_2P','Weibull_3P','Exponential_1P','Exponential_2P',
  'Normal_2P','Lognormal_2P','Lognormal_3P',
  'Gamma_2P','Gamma_3P','Loglogistic_2P','Loglogistic_3P',
  'Beta_2P','Gumbel_2P',
]

// 2-parameter distributions support likelihood contour comparison
const TWO_P_DISTS = ['Weibull_2P','Normal_2P','Lognormal_2P','Gamma_2P',
                     'Loglogistic_2P','Beta_2P','Gumbel_2P']

// Special Weibull models fitted via the /life-data/special endpoint
const SPECIAL_MODELS: { value: string; label: string }[] = [
  { value: 'mixture', label: 'Weibull Mixture' },
  { value: 'competing_risks', label: 'Competing Risks' },
  { value: 'dszi', label: 'Defective Subpopulation Zero Inflated (DSZI)' },
  { value: 'ds', label: 'Defective Subpopulation (DS)' },
  { value: 'zi', label: 'Zero Inflated (ZI)' },
  { value: 'grouped', label: 'Grouped 2P Weibull' },
]

const SPECIAL_MODEL_TIP =
  'Special Weibull models. Mixture: additive combination of 2 distributions ' +
  '(proportions sum to 1). Competing risks: product of survival functions ' +
  '(failure modes competing). DSZI: defective subpopulation (CDF < 1) combined ' +
  'with zero-inflated (dead-on-arrival at t=0). DS: a fraction of the population ' +
  'never fails. ZI: a fraction fails immediately at t=0. Grouped: 2P Weibull fitted ' +
  'to grouped failure quantities.'

const DIST_PARAM_FIELDS: Record<string, string[]> = {
  Weibull_2P: ['eta', 'beta'], Weibull_3P: ['eta', 'beta', 'gamma'],
  Exponential_1P: ['Lambda'], Exponential_2P: ['Lambda', 'gamma'],
  Normal_2P: ['mu', 'sigma'],
  Lognormal_2P: ['mu', 'sigma'], Lognormal_3P: ['mu', 'sigma', 'gamma'],
  Gamma_2P: ['alpha', 'beta'], Gamma_3P: ['alpha', 'beta', 'gamma'],
  Loglogistic_2P: ['alpha', 'beta'], Loglogistic_3P: ['alpha', 'beta', 'gamma'],
  Beta_2P: ['alpha', 'beta'], Gumbel_2P: ['mu', 'sigma'],
}

const PARAM_DEFAULTS: Record<string, string> = {
  eta: '100', alpha: '100', beta: '2', gamma: '0', mu: '100', sigma: '20', Lambda: '0.01',
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
  includeSuspensions: boolean
  suspensionRate: string
}

interface Folio {
  id: string
  name: string
  rows: DataRow[]
  method: 'MLE' | 'RRX' | 'RRY'
  ci: number
  ciText: string
  selectedDists: string[]
  analysisMode: 'parametric' | 'nonparametric' | 'special' | 'weibayes'
  npMethod: 'KM' | 'NA'
  specialModel: string
  weibayesBeta: string
  dataSource: 'table' | 'spec'
  spec: SpecState
  selectedDist?: string | null
  setDist?: string | null
  result?: FitResponse | null
  npResult?: NonparametricResponse | null
  specResult?: SpecCurvesResponse | null
  specialResult?: SpecialModelResponse | null
  weibayesResult?: WeibayesResponse | null
}

interface CompareState {
  folioIds: string[]
  distribution: string
  ciText: string
  ciLevels: number[]
  result?: CompareResponse | null
  extraResults?: CompareResponse[]
  ssStressId?: string | null
  ssStrengthId?: string | null
  ssResult?: (StressStrengthResponse & { stressName: string; strengthName: string
    stressDist: string; strengthDist: string }) | null
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
  params: { eta: '100', beta: '2' },
  n: '20',
  seed: '',
  includeSuspensions: false,
  suspensionRate: '20',
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
  specialModel: 'mixture',
  weibayesBeta: '2.0',
  dataSource: 'table',
  spec: defaultSpec(),
  setDist: null,
})

const INITIAL_STATE: LifeDataState = {
  folios: [makeFolio(1)],
  activeId: 'folio1',
  folioSeq: 1,
  compare: { folioIds: [], distribution: 'Weibull_2P', ciText: '0.95', ciLevels: [0.90, 0.95] },
}

const fmt = (v: number | null | undefined) =>
  v == null ? '—'
    : (Math.abs(v) !== 0 && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3))
      ? v.toExponential(3) : v.toFixed(4)

const fmtNum = (v: number | null | undefined) =>
  v == null ? '—' : (Math.abs(v) >= 1e5 ? v.toExponential(3) : v.toFixed(2))

function CalcRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-gray-100 last:border-0 py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-800 font-semibold">{value}</span>
    </div>
  )
}

function StressStrengthTool() {
  const [ssOpen, setSsOpen] = useState(false)
  const [stressDist, setStressDist] = useState('Normal_2P')
  const [strengthDist, setStrengthDist] = useState('Normal_2P')
  const [stressParams, setStressParams] = useState<Record<string, string>>({ mu: '100', sigma: '15' })
  const [strengthParams, setStrengthParams] = useState<Record<string, string>>({ mu: '120', sigma: '10' })
  const [ssResult, setSsResult] = useState<StressStrengthResponse | null>(null)
  const [ssLoading, setSsLoading] = useState(false)
  const [ssError, setSsError] = useState<string | null>(null)

  const runSS = async () => {
    setSsError(null)
    setSsLoading(true)
    try {
      const sp: Record<string, number> = {}
      for (const [k, v] of Object.entries(stressParams)) { sp[k] = parseFloat(v) }
      const stp: Record<string, number> = {}
      for (const [k, v] of Object.entries(strengthParams)) { stp[k] = parseFloat(v) }
      const res = await computeStressStrength({
        stress_distribution: stressDist, stress_params: sp,
        strength_distribution: strengthDist, strength_params: stp,
      })
      setSsResult(res)
    } catch (e: unknown) {
      setSsError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error.')
    } finally {
      setSsLoading(false)
    }
  }

  return (
    <div className="border-t border-gray-200 pt-3">
      <button onClick={() => setSsOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-semibold text-gray-600 w-full">
        Stress-Strength Interference
        <span className="ml-auto text-gray-400">{ssOpen ? '▾' : '▸'}</span>
      </button>
      {ssOpen && (
        <div className="mt-2 flex flex-col gap-2">
          <div>
            <InfoLabel tip="Distribution representing the applied stress or load" className="text-[10px] text-gray-500 mb-0.5">Stress distribution</InfoLabel>
            <select value={stressDist} onChange={e => {
              setStressDist(e.target.value)
              const fields = DIST_PARAM_FIELDS[e.target.value] ?? []
              setStressParams(Object.fromEntries(fields.map(f => [f, PARAM_DEFAULTS[f] ?? '1'])))
            }}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {ALL_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-1 mt-1">
              {(DIST_PARAM_FIELDS[stressDist] ?? []).map(p => (
                <input key={p} type="text" placeholder={p}
                  value={stressParams[p] ?? ''}
                  onChange={e => setStressParams(prev => ({ ...prev, [p]: e.target.value }))}
                  className="text-xs border border-gray-300 rounded px-1.5 py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                  title={p} />
              ))}
            </div>
          </div>
          <div>
            <InfoLabel tip="Distribution representing the material or component strength capacity" className="text-[10px] text-gray-500 mb-0.5">Strength distribution</InfoLabel>
            <select value={strengthDist} onChange={e => {
              setStrengthDist(e.target.value)
              const fields = DIST_PARAM_FIELDS[e.target.value] ?? []
              setStrengthParams(Object.fromEntries(fields.map(f => [f, PARAM_DEFAULTS[f] ?? '1'])))
            }}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {ALL_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-1 mt-1">
              {(DIST_PARAM_FIELDS[strengthDist] ?? []).map(p => (
                <input key={p} type="text" placeholder={p}
                  value={strengthParams[p] ?? ''}
                  onChange={e => setStrengthParams(prev => ({ ...prev, [p]: e.target.value }))}
                  className="text-xs border border-gray-300 rounded px-1.5 py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                  title={p} />
              ))}
            </div>
          </div>
          {ssError && <p className="text-[10px] text-red-600">{ssError}</p>}
          <button onClick={runSS} disabled={ssLoading}
            className="flex items-center justify-center gap-1 border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-xs font-medium py-1.5 rounded transition-colors">
            <Play size={10} /> {ssLoading ? 'Computing...' : 'Compute P(failure)'}
          </button>
          {ssResult && (
            <div className="p-2 bg-blue-50 rounded border border-blue-200">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-gray-500">P(failure)</p>
                  <p className="text-sm font-bold text-red-600">{ssResult.probability_of_failure.toExponential(4)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500">Reliability</p>
                  <p className="text-sm font-bold text-blue-700">{ssResult.reliability.toFixed(6)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 2×2 grid of PDF / CDF / SF / HF subplots sharing the same overlays (#11). */
function QuadGrid({ src, build, title, units }: {
  src: CurveData
  build: (s: CurveData, key: CurveKey, label: string) => Record<string, unknown>[]
  title: string
  units: string
}) {
  // Stacked vertically (PDF, CDF, SF, HF top→bottom) on a single shared x-axis
  // so a "spike across" crosshair lets the user inspect the same time value on
  // every function at once.
  const panels: { key: CurveKey; label: string }[] = [
    { key: 'pdf', label: 'PDF' }, { key: 'cdf', label: 'CDF' },
    { key: 'sf', label: 'SF' }, { key: 'hf', label: 'HF' },
  ]
  const n = panels.length
  const gap = 0.03
  const bandH = (1 - gap * (n - 1)) / n

  const traces: Record<string, unknown>[] = []
  // Divider lines: paper-referenced horizontal lines drawn at each inter-panel
  // boundary so the subplots are visually separated.
  const shapes: Record<string, unknown>[] = []

  const layout: Record<string, unknown> = {
    margin: { t: 30, r: 20, b: 52, l: 64 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    showlegend: false,
    hovermode: 'x',
    title: { text: title, font: { size: 12 } },
  }
  const bottomAxis = `y${n}` // smallest domain band → x-axis anchors here
  ;(layout as Record<string, unknown>).xaxis = {
    title: { text: `Time (${units})` },
    gridcolor: '#e5e7eb',
    anchor: bottomAxis,
    showspikes: true, spikemode: 'across', spikesnap: 'cursor',
    spikecolor: '#64748b', spikethickness: 1, spikedash: 'dot',
  }

  panels.forEach((p, i) => {
    const top = 1 - i * (bandH + gap)
    const bottom = Math.max(0, top - bandH)
    const idx = i === 0 ? '' : String(i + 1)
    layout[`yaxis${idx}`] = {
      title: { text: p.label, font: { size: 11 } },
      gridcolor: '#e5e7eb',
      domain: [bottom, top],
      zeroline: false,
    }
    const yref = `y${idx}`
    for (const tr of build(src, p.key, p.label)) {
      traces.push({ ...tr, xaxis: 'x', yaxis: yref })
    }
    // Add a horizontal divider line at the bottom of each panel except the last.
    if (i < n - 1) {
      shapes.push({
        type: 'line',
        xref: 'paper', yref: 'paper',
        x0: 0, x1: 1,
        y0: bottom, y1: bottom,
        line: { color: '#cbd5e1', width: 1.5 },
      })
    }
  })

  layout.shapes = shapes

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 960 }}>
        <Plot
          data={traces as Plotly.Data[]}
          layout={layout as PlotlyLayout}
          config={{ responsive: true }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </div>
    </div>
  )
}

export default function LifeData() {
  const [state, setState] = useModuleState<LifeDataState>('lifeData', INITIAL_STATE)
  const [units] = useUnits()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  // Single-screen plot view: probability plot or a distribution curve
  const [view, setView] = useState<ViewTab>('Probability')
  // Overlay a density histogram of the dataset on the PDF curve
  const [showHistogram, setShowHistogram] = useState(false)
  // Overlay characteristic-life markers (mean, B50, B10, eta) on curve plots (#6/#10)
  const [showSalient, setShowSalient] = useState(false)
  // Overlay right-censored (suspension) times on curve plots (#7/#10)
  const [showSuspensions, setShowSuspensions] = useState(false)
  // Quad view: show PDF + CDF + SF + HF in a 2x2 grid (#11)
  const [quadView, setQuadView] = useState(false)
  // Which comparison plot is shown in the Compare view
  const [compareView, setCompareView] = useState<'Contours' | 'P-P' | 'Q-Q' | 'PDF' | 'CDF' | 'SF' | 'HF'>('Contours')
  // Quick Reliability Calculator state
  const [calcTime, setCalcTime] = useState('')
  const [calcElapsed, setCalcElapsed] = useState('')
  const [calcRel, setCalcRel] = useState('0.9')
  const [calcBx, setCalcBx] = useState('10')
  const [calcResult, setCalcResult] = useState<CalculatorResponse | null>(null)
  const [calcLoading, setCalcLoading] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const importFolioRef = useRef<HTMLInputElement>(null)
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
    const f = state.folios.find(x => x.id === id)
    if (f) {
      const hasData = f.rows.some(r => r.time.trim() !== '')
      const hasResults = !!(f.result || f.npResult || f.specResult || f.specialResult)
      const msg = hasData && !hasResults
        ? `"${f.name}" has data that hasn't been analyzed. Close anyway?`
        : `Close "${f.name}"? Its data and results will be discarded.`
      if (!window.confirm(msg)) return
    }
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

  const handleImportFolio = (file: File) => {
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
        if (imported.length > 0) {
          setState(s => {
            const seq = s.folioSeq + 1
            const f = makeFolio(seq)
            f.name = file.name.replace(/\.csv$/i, '') || `Folio ${seq}`
            f.rows = imported.length < 3
              ? [...imported, ...Array.from({ length: 3 - imported.length }, newRow)]
              : imported
            return { ...s, folios: [...s.folios, f], activeId: f.id, folioSeq: seq }
          })
        }
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
        patchActive({ result: res, selectedDist: res.best_distribution, specResult: null, npResult: null, specialResult: null, weibayesResult: null })
        setView('Probability')
      } else {
        const res = await fitNonparametric({
          failures,
          right_censored: rc.length ? rc : undefined,
          method: folio.npMethod,
        })
        patchActive({ npResult: res, specResult: null, result: null, specialResult: null, weibayesResult: null })
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running analysis.')
    } finally {
      setLoading(false)
    }
  }

  const runSpecial = async () => {
    const { failures, rc } = folioData(folio)
    if (failures.length < 2) {
      setError('Enter at least 2 failure times.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fitSpecialModel({
        model: folio.specialModel,
        failures,
        right_censored: rc.length ? rc : undefined,
        // Grouped 2P Weibull requires quantities; pass 1 per distinct failure time.
        failure_quantities: folio.specialModel === 'grouped'
          ? failures.map(() => 1) : undefined,
        CI: folio.ci,
      })
      patchActive({ specialResult: res, result: null, npResult: null, specResult: null, weibayesResult: null })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error fitting special model.')
    } finally {
      setLoading(false)
    }
  }

  const runWeibayes = async () => {
    const { failures, rc } = folioData(folio)
    if (failures.length === 0 && rc.length === 0) {
      setError('Enter at least one failure or suspension time.')
      return
    }
    const beta = parseFloat(folio.weibayesBeta)
    if (isNaN(beta) || beta <= 0) {
      setError('Assumed shape β must be greater than 0.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fitWeibayes({
        failures,
        right_censored: rc.length ? rc : undefined,
        beta,
        CI: folio.ci,
      })
      patchActive({ weibayesResult: res, result: null, npResult: null, specResult: null, specialResult: null })
      setView('SF')
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running Weibayes fit.')
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
      patchActive({ specResult: res, result: null, npResult: null, specialResult: null, weibayesResult: null })
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
    // Warn before discarding existing data points in this folio.
    const existing = folio.rows.filter(r => r.time.trim() !== '').length
    if (existing > 0) {
      const ok = window.confirm(
        `This folio already contains ${existing} data point${existing !== 1 ? 's' : ''}. ` +
        `Generating a new dataset will replace the existing data — this cannot be undone.\n\n` +
        `Replace the current data?`
      )
      if (!ok) return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await generateSamples({
        distribution: folio.spec.distribution,
        params, n,
        seed: isNaN(seed) ? undefined : seed,
      })
      // Optionally mark a random percentage of samples as suspensions
      const suspRate = folio.spec.includeSuspensions
        ? Math.max(0, Math.min(100, parseFloat(folio.spec.suspensionRate) || 0)) / 100
        : 0
      const rows = res.samples.map(s => {
        const isSuspension = suspRate > 0 && Math.random() < suspRate
        return {
          key: makeKey(), id: '', time: String(s),
          state: (isSuspension ? 'S' : 'F') as 'F' | 'S',
        }
      })
      patchActive({
        rows,
        dataSource: 'table',
      })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error generating samples.')
    } finally {
      setLoading(false)
    }
  }

  const runCompare = async () => {
    const levels = state.compare.ciLevels.filter(v => v > 0 && v < 1)
    if (levels.length === 0) { setError('Add at least one valid CI level (0–1).'); return }
    const selected = state.folios.filter(f => state.compare.folioIds.includes(f.id))
    if (selected.length < 2) { setError('Select at least 2 folios to compare.'); return }
    const payload: { name: string; failures: number[]; right_censored?: number[] }[] = []
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
      const results = await Promise.all(
        levels.map(ci => compareFolios({
          folios: payload,
          distribution: state.compare.distribution,
          CI: ci,
        }))
      )
      setState(s => ({
        ...s,
        compare: { ...s.compare, result: results[0], extraResults: results.slice(1) },
      }))
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error comparing folios.')
    } finally {
      setLoading(false)
    }
  }

  // --- stress-strength between folios (fitted distributions) ---

  /** Extract a folio's fitted distribution and numeric parameters
   *  (its confirmed setDist, or the best fit). Null if not fitted. */
  const folioFittedDist = (f: Folio): { dist: string; params: Record<string, number> } | null => {
    const res = f.result
    if (!res) return null
    const dist = f.setDist || res.best_distribution
    const row = res.results.find(r => r.Distribution === dist)
    if (!row?.params) return null
    const params: Record<string, number> = {}
    for (const p of DIST_PARAM_FIELDS[dist] ?? []) {
      const v = row.params[p]
      if (typeof v === 'number') params[p] = v
    }
    if (Object.keys(params).length === 0) return null
    return { dist, params }
  }

  const runCompareSS = async () => {
    const stressF = state.folios.find(f => f.id === state.compare.ssStressId)
    const strengthF = state.folios.find(f => f.id === state.compare.ssStrengthId)
    if (!stressF || !strengthF) { setError('Select both a stress folio and a strength folio.'); return }
    if (stressF.id === strengthF.id) { setError('Stress and strength must be different folios.'); return }
    const sd = folioFittedDist(stressF)
    if (!sd) { setError(`Folio "${stressF.name}" has no fitted distribution — run its analysis first.`); return }
    const gd = folioFittedDist(strengthF)
    if (!gd) { setError(`Folio "${strengthF.name}" has no fitted distribution — run its analysis first.`); return }
    setError(null)
    setLoading(true)
    try {
      const res = await computeStressStrength({
        stress_distribution: sd.dist, stress_params: sd.params,
        strength_distribution: gd.dist, strength_params: gd.params,
      })
      setState(s => ({
        ...s,
        compare: {
          ...s.compare,
          ssResult: {
            ...res,
            stressName: stressF.name, strengthName: strengthF.name,
            stressDist: sd.dist, strengthDist: gd.dist,
          },
        },
      }))
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Stress-strength computation failed.')
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

  // --- quick reliability calculator ---

  const runCalc = async () => {
    const dist = folio.setDist
    if (!dist || !fitResult) return
    const row = fitResult.results.find(r => r.Distribution === dist)
    if (!row?.params) return
    const numericParams: Record<string, number> = {}
    for (const pName of DIST_PARAM_FIELDS[dist] ?? []) {
      const v = row.params[pName]
      if (typeof v === 'number') numericParams[pName] = v
    }
    const num = (s: string) => { const v = parseFloat(s); return isNaN(v) ? null : v }
    setCalcLoading(true)
    try {
      const res = await calculateMetrics({
        distribution: dist, params: numericParams,
        mission_end: num(calcTime),
        elapsed: num(calcElapsed),
        reliability_target: num(calcRel),
        bx_percent: num(calcBx),
      })
      setCalcResult(res)
    } catch {
      setCalcResult(null)
    } finally {
      setCalcLoading(false)
    }
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
    // Overlay right-censored (suspension) times on the probability plot.
    // p.line_x is in transformed plot-space (e.g. ln(t) for Weibull), while
    // p.line_x_raw holds the corresponding raw times. We interpolate each
    // suspension time (raw) against line_x_raw to read off the already-
    // transformed line_y value directly — no second transform is applied.
    if (showSuspensions && p.line_x_raw && p.line_x_raw.length > 0) {
      const { rc } = folioData(folio)
      const lineXRaw = p.line_x_raw
      const lineY = p.line_y
      const px: number[] = []
      const py: number[] = []
      for (const t of rc) {
        // Find y in transformed-plot space by interpolating against raw times.
        let yv: number | null = null
        if (t <= lineXRaw[0]) {
          yv = lineY[0]
        } else if (t >= lineXRaw[lineXRaw.length - 1]) {
          yv = lineY[lineY.length - 1]
        } else {
          for (let i = 1; i < lineXRaw.length; i++) {
            if (t <= lineXRaw[i]) {
              const frac = (t - lineXRaw[i - 1]) / (lineXRaw[i] - lineXRaw[i - 1] || 1)
              yv = lineY[i - 1] + frac * (lineY[i] - lineY[i - 1])
              break
            }
          }
        }
        if (yv == null) continue
        // The x position on the probability plot is the transformed time.
        // Derive it by interpolating against line_x_raw → line_x.
        const lineX = p.line_x
        let xv: number | null = null
        if (t <= lineXRaw[0]) {
          xv = lineX[0]
        } else if (t >= lineXRaw[lineXRaw.length - 1]) {
          xv = lineX[lineX.length - 1]
        } else {
          for (let i = 1; i < lineXRaw.length; i++) {
            if (t <= lineXRaw[i]) {
              const frac = (t - lineXRaw[i - 1]) / (lineXRaw[i] - lineXRaw[i - 1] || 1)
              xv = lineX[i - 1] + frac * (lineX[i] - lineX[i - 1])
              break
            }
          }
        }
        if (xv == null) continue
        px.push(xv)
        py.push(yv)
      }
      if (px.length > 0) {
        traces.push({
          x: px, y: py, mode: 'markers', type: 'scatter',
          name: 'Suspensions',
          marker: {
            color: 'rgba(0,0,0,0)', size: 9, symbol: 'circle-open',
            line: { color: '#6b7280', width: 1.5 },
          },
          hovertemplate: 'Suspension: %{x}<extra></extra>',
        })
      }
    }
    return traces
  })()

  const probLayout = activePlot?.probability ? {
    xaxis: { title: { text: `${activePlot.probability.x_label} (${units})` }, gridcolor: '#e5e7eb' },
    yaxis: { title: { text: activePlot.probability.y_label }, gridcolor: '#e5e7eb' },
    margin: { t: 30, r: 20, b: 50, l: 60 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    showlegend: true, legend: { x: 0.02, y: 0.98 },
  } : {}

  const curveTab: CurveTab = view === 'Probability' ? 'CDF' : view
  const curveKey = curveTab.toLowerCase() as 'pdf' | 'cdf' | 'sf' | 'hf'
  const curveSource = folio.specResult?.curves ?? activePlot?.curves

  // η override for salient points: prefer the fitted Weibull eta when available.
  const activeEta = (() => {
    if (!fitResult) return null
    const row = fitResult.results.find(r => r.Distribution === activeDist)
    const v = row?.params?.eta
    return typeof v === 'number' ? v : null
  })()
  const salientPoints = showSalient && curveSource
    ? computeSalientPoints(curveSource as CurveData, activeEta)
    : []

  // Build the traces for a single distribution curve (used by single & quad views).
  const buildCurveTraces = (
    src: CurveData, key: CurveKey, label: string,
  ): Record<string, unknown>[] => {
    const dyn = src as unknown as Record<string, number[] | undefined>
    const traces: Record<string, unknown>[] = []
    const lower = dyn[`${key}_lower`]
    const upper = dyn[`${key}_upper`]
    if ((key === 'sf' || key === 'cdf') && lower && upper) {
      traces.push({ x: src.x, y: upper, mode: 'lines', line: { width: 0 },
        showlegend: false, hoverinfo: 'skip' })
      traces.push({ x: src.x, y: lower, mode: 'lines', name: `${ciPct}% CI`,
        fill: 'tonexty', fillcolor: 'rgba(59,130,246,0.15)', line: { width: 0 }, hoverinfo: 'skip' })
    }
    // Optional dataset density histogram, overlaid on the PDF curve.
    if (showHistogram && key === 'pdf') {
      const { failures } = folioData(folio)
      if (failures.length > 0) {
        traces.push({
          x: failures, type: 'histogram', histnorm: 'probability density',
          name: 'Data histogram', marker: { color: 'rgba(148,163,184,0.45)' },
          opacity: 0.7,
        })
      }
    }
    traces.push({
      x: src.x, y: dyn[key], mode: 'lines',
      line: { color: '#3b82f6', width: 2 }, name: label,
    })
    if (showSalient && salientPoints.length > 0) {
      const t = salientTrace(salientPoints, src, key)
      if (t) traces.push(t)
    }
    if (showSuspensions) {
      const { rc } = folioData(folio)
      const t = suspensionTrace(rc, src, key)
      if (t) traces.push(t)
    }
    return traces
  }

  const curvePlotData = curveSource
    ? buildCurveTraces(curveSource as CurveData, curveKey, curveTab)
    : []

  const curveLayout: PlotlyLayout = {
    xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
    yaxis: { title: { text: curveTab }, gridcolor: '#e5e7eb' },
    margin: { t: 30, r: 20, b: 50, l: 60 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
  }

  // --- special model plots ---

  const specialResult = folio.specialResult
  const specialParams = specialResult?.params ?? []
  const specialSfData = (() => {
    if (!specialResult?.curves?.sf || !specialResult.curves.x) return []
    const c = specialResult.curves
    return [{ x: c.x, y: c.sf, mode: 'lines', name: 'SF',
      line: { color: '#3b82f6', width: 2 } }]
  })()
  const specialCdfData = (() => {
    if (!specialResult?.curves?.cdf || !specialResult.curves.x) return []
    const c = specialResult.curves
    return [{ x: c.x, y: c.cdf, mode: 'lines', name: 'CDF',
      line: { color: '#ef4444', width: 2 } }]
  })()

  // --- weibayes plots (#15) ---

  const weibayesResult = folio.weibayesResult
  const weibayesCurveData = (() => {
    if (!weibayesResult?.curves?.x) return []
    const c = weibayesResult.curves
    const dyn = c as unknown as Record<string, (number | null)[] | undefined>
    const y = dyn[curveKey]
    if (!y) return []
    const traces: Record<string, unknown>[] = []
    if (curveKey === 'sf' && c.sf_lower && c.sf_upper) {
      traces.push({ x: c.x, y: c.sf_upper, mode: 'lines', line: { width: 0 },
        showlegend: false, hoverinfo: 'skip' })
      traces.push({ x: c.x, y: c.sf_lower, mode: 'lines',
        name: `${Math.round(weibayesResult.CI * 100)}% CI`,
        fill: 'tonexty', fillcolor: 'rgba(59,130,246,0.15)', line: { width: 0 }, hoverinfo: 'skip' })
    }
    traces.push({ x: c.x, y, mode: 'lines', name: curveTab,
      line: { color: '#3b82f6', width: 2 } })
    if (showSuspensions) {
      const { rc } = folioData(folio)
      const t = suspensionTrace(rc, c as unknown as CurveData, curveKey)
      if (t) traces.push(t)
    }
    return traces
  })()

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

  const PARAM_NAMES = ['eta', 'alpha', 'beta', 'gamma', 'mu', 'sigma', 'Lambda']
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

  // --- compare plot (supports multiple CI levels) ---

  const compareResult = state.compare.result
  const allCompareResults = [
    ...(compareResult ? [compareResult] : []),
    ...(state.compare.extraResults ?? []),
  ]
  const contourData = (() => {
    if (allCompareResults.length === 0) return []
    const traces: Record<string, unknown>[] = []
    const DASH_STYLES = ['solid', 'dash', 'dot', 'dashdot']
    allCompareResults.forEach((res, ci_idx) => {
      const ciPctLabel = `${Math.round(res.CI * 100)}%`
      const isPrimary = ci_idx === 0
      res.folios.forEach((f, i) => {
        const color = FOLIO_COLORS[i % FOLIO_COLORS.length]
        if (!f.contour) return
        traces.push({
          type: 'contour',
          x: f.contour.x, y: f.contour.y, z: f.contour.nll,
          contours: { start: f.contour.level, end: f.contour.level, size: 1,
                      coloring: 'lines' },
          showscale: false,
          line: { color, width: isPrimary ? 2 : 1.5, dash: DASH_STYLES[ci_idx % DASH_STYLES.length] },
          name: allCompareResults.length > 1 ? `${f.name} (${ciPctLabel})` : f.name,
          showlegend: true,
          hoverinfo: 'skip',
          legendgroup: f.name,
        })
        if (isPrimary && f.contour.point[0] != null) {
          traces.push({
            type: 'scatter',
            x: [f.contour.point[0]], y: [f.contour.point[1]],
            mode: 'markers', marker: { color, size: 9, symbol: 'x' },
            name: `${f.name} MLE`, showlegend: false,
            legendgroup: f.name,
            hovertemplate: `${f.name}<br>${f.contour.x_name}=%{x:.4g}<br>${f.contour.y_name}=%{y:.4g}<extra></extra>`,
          })
        }
      })
    })
    return traces
  })()
  const contourAxes = allCompareResults[0]?.folios.find(f => f.contour)?.contour

  // Function comparison (PDF/CDF/SF/HF): one line per folio from the primary fit.
  const functionCompareData = (key: 'pdf' | 'cdf' | 'sf' | 'hf') => {
    if (!compareResult) return []
    return compareResult.folios.map((f, i) => ({
      x: f.curves?.x, y: f.curves?.[key], mode: 'lines', name: f.name,
      line: { color: FOLIO_COLORS[i % FOLIO_COLORS.length], width: 2 },
    })).filter(t => t.x && t.y)
  }
  // P-P plot: theoretical vs empirical CDF, with a y=x reference line.
  const ppCompareData = (() => {
    if (!compareResult) return []
    const traces: Record<string, unknown>[] = [
      { x: [0, 1], y: [0, 1], mode: 'lines', name: 'Ideal', line: { color: '#9ca3af', dash: 'dash', width: 1 }, hoverinfo: 'skip' },
    ]
    compareResult.folios.forEach((f, i) => {
      if (!f.pp) return
      traces.push({ x: f.pp.theoretical, y: f.pp.empirical, mode: 'markers', name: f.name,
        marker: { color: FOLIO_COLORS[i % FOLIO_COLORS.length], size: 5 } })
    })
    return traces
  })()
  // Q-Q plot: theoretical vs empirical quantiles, with a y=x reference line.
  const qqCompareData = (() => {
    if (!compareResult) return []
    const all: number[] = []
    compareResult.folios.forEach(f => { if (f.qq) all.push(...f.qq.theoretical, ...f.qq.empirical) })
    const lo = Math.min(...all, 0), hi = Math.max(...all, 1)
    const traces: Record<string, unknown>[] = [
      { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Ideal', line: { color: '#9ca3af', dash: 'dash', width: 1 }, hoverinfo: 'skip' },
    ]
    compareResult.folios.forEach((f, i) => {
      if (!f.qq) return
      traces.push({ x: f.qq.theoretical, y: f.qq.empirical, mode: 'markers', name: f.name,
        marker: { color: FOLIO_COLORS[i % FOLIO_COLORS.length], size: 5 } })
    })
    return traces
  })()

  const compareViewData = (): { data: Record<string, unknown>[]; xLabel: string; yLabel: string } => {
    switch (compareView) {
      case 'P-P': return { data: ppCompareData, xLabel: 'Theoretical CDF', yLabel: 'Empirical CDF' }
      case 'Q-Q': return { data: qqCompareData, xLabel: `Theoretical quantile (${units})`, yLabel: `Empirical quantile (${units})` }
      case 'PDF': return { data: functionCompareData('pdf'), xLabel: `Time (${units})`, yLabel: 'PDF' }
      case 'CDF': return { data: functionCompareData('cdf'), xLabel: `Time (${units})`, yLabel: 'CDF' }
      case 'SF': return { data: functionCompareData('sf'), xLabel: `Time (${units})`, yLabel: 'Survival function' }
      case 'HF': return { data: functionCompareData('hf'), xLabel: `Time (${units})`, yLabel: 'Hazard function' }
      default: return { data: [], xLabel: '', yLabel: '' }
    }
  }

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
            <span className="flex flex-col items-start leading-tight">
              <span>{f.name}</span>
              {f.setDist && (
                <span className="text-[9px] text-green-600 font-normal flex items-center gap-0.5">
                  <Check size={8} />{f.setDist}
                </span>
              )}
            </span>
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
        <button onClick={() => importFolioRef.current?.click()} title="Import CSV as new folio"
          className="px-2 py-1.5 text-gray-400 hover:text-emerald-600">
          <Upload size={14} />
        </button>
        <input ref={importFolioRef} type="file" accept=".csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFolio(f); e.target.value = '' }} />
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
              <InfoLabel tip="Select two or more folios to compare statistically. Each folio must have failure data entered.">Folios to compare</InfoLabel>
              <div className="flex flex-col gap-1">
                {state.folios.map(f => {
                  const { failures, rc } = folioData(f)
                  const effectiveDist = f.setDist || f.result?.best_distribution
                  return (
                    <label key={f.id} className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                      <input type="checkbox"
                        checked={state.compare.folioIds.includes(f.id)}
                        onChange={() => {
                          setState(s => {
                            const wasSelected = s.compare.folioIds.includes(f.id)
                            const newIds = wasSelected
                              ? s.compare.folioIds.filter(x => x !== f.id)
                              : [...s.compare.folioIds, f.id]
                            // Auto-fill distribution from the first selected folio's setDist
                            let newDist = s.compare.distribution
                            if (!wasSelected && newIds.length === 1) {
                              const firstFolio = s.folios.find(x => x.id === f.id)
                              const fDist = firstFolio?.setDist || firstFolio?.result?.best_distribution
                              if (fDist && TWO_P_DISTS.includes(fDist)) newDist = fDist
                            }
                            return {
                              ...s,
                              compare: { ...s.compare, folioIds: newIds, distribution: newDist },
                            }
                          })
                        }}
                        className="rounded text-blue-600 mt-0.5" />
                      <span className="flex flex-col leading-tight">
                        <span>
                          {f.name}
                          <span className="text-gray-400"> ({failures.length}F {rc.length}S)</span>
                        </span>
                        {effectiveDist && (
                          <span className={`text-[10px] flex items-center gap-0.5 ${f.setDist ? 'text-green-600' : 'text-gray-400'}`}>
                            {f.setDist && <Check size={8} />}
                            {f.setDist ? f.setDist : `best: ${effectiveDist}`}
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <InfoLabel tip="Distribution used for comparison. Only 2-parameter distributions support likelihood contour plots.">Distribution</InfoLabel>
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
              <InfoLabel tip="Add one or more confidence levels (between 0 and 1). Each level produces a separate contour ring on the comparison plot.">Confidence levels</InfoLabel>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {state.compare.ciLevels.map((ci, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-mono px-2 py-0.5 rounded">
                    {Math.round(ci * 100)}%
                    <button onClick={() => setState(s => ({
                      ...s, compare: { ...s.compare, ciLevels: s.compare.ciLevels.filter((_, j) => j !== i) },
                    }))} className="text-blue-400 hover:text-red-500">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input type="text" value={state.compare.ciText}
                  onChange={e => setState(s => ({ ...s, compare: { ...s.compare, ciText: e.target.value } }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const v = parseFloat(state.compare.ciText)
                      if (!isNaN(v) && v > 0 && v < 1 && !state.compare.ciLevels.includes(v)) {
                        setState(s => ({ ...s, compare: { ...s.compare, ciLevels: [...s.compare.ciLevels, v].sort(), ciText: '' } }))
                      }
                    }
                  }}
                  placeholder="e.g. 0.99"
                  className="w-20 text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <button onClick={() => {
                  const v = parseFloat(state.compare.ciText)
                  if (!isNaN(v) && v > 0 && v < 1 && !state.compare.ciLevels.includes(v)) {
                    setState(s => ({ ...s, compare: { ...s.compare, ciLevels: [...s.compare.ciLevels, v].sort(), ciText: '' } }))
                  }
                }} className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">
                  <Plus size={12} />
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Each level gets its own contour ring on the plot.
              </p>
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

            <button onClick={runCompare} disabled={loading}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors">
              <GitCompare size={14} />
              {loading ? 'Comparing...' : 'Run Comparison'}
            </button>

            {/* Stress-Strength between folios */}
            <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-700">Stress-Strength Interference</p>
              <p className="text-[10px] text-gray-400 leading-snug">
                Designate one fitted folio as the stress distribution and another as strength.
                P(failure) = P(stress &gt; strength).
              </p>
              {(() => {
                const fitted = state.folios.filter(f => folioFittedDist(f) != null)
                if (fitted.length < 2) {
                  return (
                    <p className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded">
                      At least 2 folios with fitted distributions are required.
                      Run analysis on each folio first.
                    </p>
                  )
                }
                return (
                  <>
                    <div>
                      <InfoLabel tip="Select the folio whose fitted distribution represents the applied stress" className="text-[10px] text-gray-500 mb-0.5">Stress folio</InfoLabel>
                      <select value={state.compare.ssStressId ?? ''}
                        onChange={e => setState(s => ({ ...s, compare: { ...s.compare, ssStressId: e.target.value || null } }))}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="">— select —</option>
                        {fitted.map(f => {
                          const fd = folioFittedDist(f)!
                          return <option key={f.id} value={f.id}>{f.name} ({fd.dist})</option>
                        })}
                      </select>
                    </div>
                    <div>
                      <InfoLabel tip="Select the folio whose fitted distribution represents the material or component strength" className="text-[10px] text-gray-500 mb-0.5">Strength folio</InfoLabel>
                      <select value={state.compare.ssStrengthId ?? ''}
                        onChange={e => setState(s => ({ ...s, compare: { ...s.compare, ssStrengthId: e.target.value || null } }))}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="">— select —</option>
                        {fitted.map(f => {
                          const fd = folioFittedDist(f)!
                          return <option key={f.id} value={f.id}>{f.name} ({fd.dist})</option>
                        })}
                      </select>
                    </div>
                    <button onClick={runCompareSS} disabled={loading}
                      className="flex items-center justify-center gap-1 border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-xs font-medium py-1.5 rounded transition-colors">
                      <Play size={10} /> Compute Interference
                    </button>
                  </>
                )
              })()}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {/* Stress-Strength result (folio-based) */}
            {state.compare.ssResult && (() => {
              const ss = state.compare.ssResult
              return (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Stress-Strength Interference —{' '}
                    <span className="text-red-600">{ss.stressName}</span> (stress) vs{' '}
                    <span className="text-blue-600">{ss.strengthName}</span> (strength)
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <div className="rounded-lg border bg-red-50 border-red-200 p-3">
                      <p className="text-xs text-gray-500">P(failure)</p>
                      <p className="text-lg font-bold text-red-600">{ss.probability_of_failure.toExponential(4)}</p>
                    </div>
                    <div className="rounded-lg border bg-blue-50 border-blue-200 p-3">
                      <p className="text-xs text-gray-500">Reliability</p>
                      <p className="text-lg font-bold text-blue-700">{ss.reliability.toFixed(6)}</p>
                    </div>
                    <div className="rounded-lg border bg-white border-gray-200 p-3">
                      <p className="text-xs text-gray-500">Stress model</p>
                      <p className="text-sm font-semibold text-gray-900">{ss.stressDist}</p>
                    </div>
                    <div className="rounded-lg border bg-white border-gray-200 p-3">
                      <p className="text-xs text-gray-500">Strength model</p>
                      <p className="text-sm font-semibold text-gray-900">{ss.strengthDist}</p>
                    </div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 320 }}>
                    <Plot
                      data={[
                        { x: ss.curves.x, y: ss.curves.stress_pdf, mode: 'lines',
                          name: `Stress (${ss.stressName})`, fill: 'tozeroy',
                          fillcolor: 'rgba(239,68,68,0.15)', line: { color: '#ef4444', width: 2 } },
                        { x: ss.curves.x, y: ss.curves.strength_pdf, mode: 'lines',
                          name: `Strength (${ss.strengthName})`, fill: 'tozeroy',
                          fillcolor: 'rgba(59,130,246,0.15)', line: { color: '#3b82f6', width: 2 } },
                      ] as Plotly.Data[]}
                      layout={{
                        xaxis: { title: { text: 'Value' }, gridcolor: '#e5e7eb' },
                        yaxis: { title: { text: 'Probability Density' }, gridcolor: '#e5e7eb' },
                        margin: { t: 20, r: 20, b: 50, l: 60 },
                        paper_bgcolor: 'white', plot_bgcolor: 'white',
                        legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                        showlegend: true,
                      } as PlotlyLayout}
                      config={{ responsive: true }}
                      style={{ width: '100%', height: '100%' }}
                      useResizeHandler
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    The overlap of the two density curves drives the interference probability.
                  </p>
                </div>
              )
            })()}

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

                {/* Comparison plots: contours + P-P / Q-Q / function overlays */}
                {compareResult && (
                  <div>
                    <div className="flex items-center gap-1 mb-2 flex-wrap">
                      {(['Contours', 'P-P', 'Q-Q', 'PDF', 'CDF', 'SF', 'HF'] as const).map(t => {
                        const disabled = t === 'Contours' && (contourData.length === 0 || !contourAxes)
                        return (
                          <button key={t} disabled={disabled} onClick={() => setCompareView(t)}
                            className={`px-3 py-1 text-xs rounded border transition-colors ${
                              compareView === t ? 'bg-blue-600 text-white border-blue-600'
                                : disabled ? 'border-gray-100 text-gray-300 cursor-not-allowed' : 'border-gray-300 text-gray-600'
                            }`}>{t}</button>
                        )
                      })}
                    </div>
                    {compareView === 'Contours' ? (
                      contourData.length > 0 && contourAxes ? (
                        <>
                          <p className="text-xs text-gray-400 mb-2">
                            {allCompareResults.map(r => `${Math.round(r.CI * 100)}%`).join(', ')} joint confidence regions.
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
                        </>
                      ) : (
                        <p className="text-xs text-gray-400">Likelihood contours require a 2-parameter distribution.</p>
                      )
                    ) : (
                      <>
                        <p className="text-xs text-gray-400 mb-2">
                          {compareView === 'P-P' ? 'Points near the diagonal indicate a good fit; separation between folios indicates differing distributions.'
                            : compareView === 'Q-Q' ? 'Points near the diagonal indicate a good fit; differing slopes/offsets indicate differing scale/shape.'
                            : `Fitted ${compareView} for each folio, overlaid for comparison.`}
                        </p>
                        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 480 }}>
                          <Plot
                            data={compareViewData().data as Plotly.Data[]}
                            layout={{
                              xaxis: { title: { text: compareViewData().xLabel }, gridcolor: '#e5e7eb' },
                              yaxis: { title: { text: compareViewData().yLabel }, gridcolor: '#e5e7eb' },
                              margin: { t: 20, r: 20, b: 50, l: 60 },
                              paper_bgcolor: 'white', plot_bgcolor: 'white',
                              showlegend: true, legend: { x: 0.02, y: 0.98, font: { size: 11 } },
                            } as any}
                            config={{ responsive: true }}
                            style={{ width: '100%', height: '100%' }}
                            useResizeHandler
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : !state.compare.ssResult ? (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <p className="text-lg font-medium">Folio Comparison</p>
                  <p className="text-sm mt-1">Select 2+ folios, then run statistical comparison with contour plots</p>
                  <p className="text-sm mt-1">Or designate stress/strength folios for interference analysis</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        /* ================= Folio view ================= */
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel */}
          <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => patchActive({ analysisMode: 'parametric', specialResult: null, npResult: null, specResult: null, weibayesResult: null })}
                className={`py-1.5 text-xs rounded font-medium border transition-colors ${
                  folio.analysisMode === 'parametric' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                }`}
              >Parametric</button>
              <button
                onClick={() => patchActive({ analysisMode: 'nonparametric', result: null, specialResult: null, specResult: null, weibayesResult: null })}
                className={`py-1.5 text-xs rounded font-medium border transition-colors ${
                  folio.analysisMode === 'nonparametric' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                }`}
              >Non-Parametric</button>
              <button
                onClick={() => patchActive({ analysisMode: 'special', result: null, npResult: null, specResult: null, weibayesResult: null })}
                className={`py-1.5 text-xs rounded font-medium border transition-colors ${
                  folio.analysisMode === 'special' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                }`}
              >Special</button>
              <button
                onClick={() => patchActive({ analysisMode: 'weibayes', result: null, npResult: null, specResult: null, specialResult: null })}
                className={`py-1.5 text-xs rounded font-medium border transition-colors ${
                  folio.analysisMode === 'weibayes' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                }`}
              >Weibayes</button>
            </div>

            {/* Data source toggle */}
            <div>
              <InfoLabel tip="Choose whether to enter observed life data in a table or specify a known distribution model directly">Data source</InfoLabel>
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
                    <InfoLabel tip="Enter failure (F) and suspension/right-censored (S) times. Paste tabular data or import a CSV file." className="mb-0">Life Data</InfoLabel>
                    <span className="text-[10px] text-gray-400">
                      {(() => { const { failures, rc } = folioData(folio); return `${failures.length}F ${rc.length}S` })()}
                    </span>
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="max-h-[40vh] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-500 w-16">ID</th>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-500">Time ({units})</th>
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
                  <InfoLabel tip="Select a parametric life distribution to specify. Parameters will be set manually below.">Distribution</InfoLabel>
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
                      <InfoLabel tip={`Distribution parameter "${p}". Enter a numeric value.`}>{p}</InfoLabel>
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
                    <InfoLabel tip="Number of random samples to generate from the specified distribution (2 to 10,000)">Samples (n)</InfoLabel>
                    <input type="text" inputMode="numeric" value={folio.spec.n}
                      onChange={e => patchActive(f => ({ spec: { ...f.spec, n: e.target.value } }))}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div>
                    <InfoLabel tip="Random seed for reproducible Monte Carlo samples. Leave blank for a random seed each time.">
                      Seed <span className="text-gray-400">(optional)</span>
                    </InfoLabel>
                    <input type="text" inputMode="numeric" value={folio.spec.seed}
                      onChange={e => patchActive(f => ({ spec: { ...f.spec, seed: e.target.value } }))}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                  <input type="checkbox"
                    checked={folio.spec.includeSuspensions}
                    onChange={e => patchActive(f => ({
                      spec: { ...f.spec, includeSuspensions: e.target.checked },
                    }))}
                    className="rounded text-blue-600" />
                  Include suspensions
                </label>
                {folio.spec.includeSuspensions && (
                  <div>
                    <InfoLabel tip="Percentage of generated samples to randomly mark as right-censored (suspensions)">
                      Suspension rate (%)
                    </InfoLabel>
                    <input type="text" inputMode="decimal"
                      value={folio.spec.suspensionRate}
                      onChange={e => patchActive(f => ({
                        spec: { ...f.spec, suspensionRate: e.target.value },
                      }))}
                      className="w-20 text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                )}
                <button onClick={generateMonteCarlo} disabled={loading}
                  className="flex items-center justify-center gap-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 text-xs font-medium py-1.5 rounded transition-colors">
                  <Dices size={12} /> Generate data into table
                </button>
              </div>
            )}

            {folio.analysisMode === 'parametric' ? (
              <>
                <div>
                  <InfoLabel tip="MLE: Maximum Likelihood Estimation (recommended for censored data). RRX/RRY: Rank Regression on X or Y axis (least-squares fit to probability plot)">Method</InfoLabel>
                  <div className="flex gap-2">
                    {(['MLE', 'RRX', 'RRY'] as const).map(m => (
                      <button key={m} onClick={() => patchActive({ method: m })}
                        className={`flex-1 py-1 text-xs rounded border transition-colors ${
                          folio.method === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                        }`}>{m}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <InfoLabel tip="Confidence level for parameter confidence intervals and bounds on the probability plot (e.g. 0.95 = 95%)">Confidence level</InfoLabel>
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
                    <InfoLabel tip="Select which parametric distributions to fit. The best fit is chosen by AICc." className="mb-0">Distributions</InfoLabel>
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
            ) : folio.analysisMode === 'nonparametric' ? (
              <div>
                <InfoLabel tip="Kaplan-Meier estimates the survival function. Nelson-Aalen estimates the cumulative hazard function.">Estimator</InfoLabel>
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
            ) : folio.analysisMode === 'special' ? (
              <div>
                <InfoLabel tip={SPECIAL_MODEL_TIP}>Special model</InfoLabel>
                <select
                  value={folio.specialModel}
                  onChange={e => patchActive({ specialModel: e.target.value })}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {SPECIAL_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                  Fitted to the failure (F) and suspension (S) data entered above.
                </p>
              </div>
            ) : (
              /* Weibayes (Bayesian Weibull with a fixed/assumed shape β) */
              <>
                <div>
                  <InfoLabel tip="Weibayes assumes a known Weibull shape β (e.g. from prior experience) and fits only the characteristic life η from the failure (F) and suspension (S) data. Supports the zero-failure case.">Assumed shape β</InfoLabel>
                  <NumberField
                    value={folio.weibayesBeta}
                    onChange={v => patchActive({ weibayesBeta: v })}
                    step={0.1}
                    min={0.0001}
                    className="w-24"
                  />
                  <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                    η is computed as (Σtᵢ^β / r)^(1/β). With zero failures, a conservative
                    lower bound on η is returned instead.
                  </p>
                </div>
                <div>
                  <InfoLabel tip="Confidence level for the bounds on the characteristic life η (e.g. 0.95 = 95%)">Confidence level</InfoLabel>
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
              </>
            )}

            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

            <button
              onClick={folio.analysisMode === 'special' ? runSpecial
                : folio.analysisMode === 'weibayes' ? runWeibayes : run}
              disabled={loading}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors"
            >
              <Play size={14} />
              {loading ? 'Running...'
                : folio.analysisMode === 'special' ? 'Fit Special Model'
                : folio.analysisMode === 'weibayes' ? 'Fit Weibayes' : 'Run Analysis'}
            </button>

            {/* Stress-Strength Interference tool */}
            <StressStrengthTool />
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {(fitResult || folio.specResult || specialResult || npResult) && (
              <div ref={resultsRef} className="flex-1 overflow-hidden flex flex-col">
                <div className="flex justify-end">
                  <ExportResultsButton getElement={() => resultsRef.current} baseName="life_data" />
                </div>
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
                      sortable
                    />
                    {/* Set Distribution indicator per row */}
                    {folio.setDist && (
                      <p className="text-[10px] text-green-600 mt-1 flex items-center gap-1">
                        <Check size={10} /> Set: {folio.setDist}
                      </p>
                    )}
                    {/* Set Distribution button */}
                    {activeDist && (
                      <button
                        onClick={() => patchActive({ setDist: activeDist })}
                        disabled={folio.setDist === activeDist}
                        className={`mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded border transition-colors ${
                          folio.setDist === activeDist
                            ? 'bg-green-50 text-green-700 border-green-300 cursor-default'
                            : 'bg-white text-blue-600 border-blue-400 hover:bg-blue-50'
                        }`}
                      >
                        {folio.setDist === activeDist ? (
                          <><Check size={12} /> Set as {activeDist}</>
                        ) : (
                          <>Set as {activeDist}</>
                        )}
                      </button>
                    )}

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

                    {/* Quick Reliability Calculator */}
                    {folio.setDist && fitResult && (
                      <div className="mt-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <p className="text-xs font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <Calculator size={12} /> Calculator
                          <span className="text-gray-400 font-normal">({folio.setDist})</span>
                        </p>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <InfoLabel tip="Mission end time t. Used for R(t), F(t), f(t), h(t), and the conditional metrics." className="text-[10px] text-gray-500 mb-0.5">Mission end ({units})</InfoLabel>
                            <input type="text" inputMode="decimal" value={calcTime}
                              onChange={e => setCalcTime(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') runCalc() }}
                              className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                              placeholder="e.g. 500" />
                          </div>
                          <div>
                            <InfoLabel tip="Time already survived. Conditional reliability = R(mission end) / R(elapsed)." className="text-[10px] text-gray-500 mb-0.5">Elapsed ({units})</InfoLabel>
                            <input type="text" inputMode="decimal" value={calcElapsed}
                              onChange={e => setCalcElapsed(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') runCalc() }}
                              className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                              placeholder="optional" />
                          </div>
                          <div>
                            <InfoLabel tip="Target reliability R. Reliable life is the time at which reliability equals this value." className="text-[10px] text-gray-500 mb-0.5">Reliability target</InfoLabel>
                            <input type="text" inputMode="decimal" value={calcRel}
                              onChange={e => setCalcRel(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') runCalc() }}
                              className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                              placeholder="0.9" />
                          </div>
                          <div>
                            <InfoLabel tip="BX% life is the time by which X% of the population has failed (e.g. B10 = 10%)." className="text-[10px] text-gray-500 mb-0.5">BX % failed</InfoLabel>
                            <input type="text" inputMode="decimal" value={calcBx}
                              onChange={e => setCalcBx(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') runCalc() }}
                              className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                              placeholder="10" />
                          </div>
                        </div>
                        <button onClick={runCalc} disabled={calcLoading}
                          className="w-full px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors mb-2">
                          {calcLoading ? 'Calculating...' : 'Calculate'}
                        </button>
                        {calcResult && (
                          <div className="flex flex-col gap-1 text-xs font-mono">
                            {calcResult.reliability != null && <CalcRow label="Reliability R(t)" value={fmt(calcResult.reliability)} />}
                            {calcResult.prob_failure != null && <CalcRow label="Prob. of failure F(t)" value={fmt(calcResult.prob_failure)} />}
                            {calcResult.conditional_reliability != null && <CalcRow label="Cond. reliability" value={fmt(calcResult.conditional_reliability)} />}
                            {calcResult.conditional_prob_failure != null && <CalcRow label="Cond. prob. of failure" value={fmt(calcResult.conditional_prob_failure)} />}
                            {calcResult.failure_rate != null && <CalcRow label={`Failure rate h(t) (/${units.replace(/s$/, '')})`} value={fmt(calcResult.failure_rate)} />}
                            {calcResult.reliable_life != null && <CalcRow label={`Reliable life (${units})`} value={fmtNum(calcResult.reliable_life)} />}
                            {calcResult.bx_life != null && <CalcRow label={`B${calcResult.bx_percent ?? ''}% life (${units})`} value={fmtNum(calcResult.bx_life)} />}
                            {calcResult.mean_life != null && <CalcRow label={`Mean life (${units})`} value={fmtNum(calcResult.mean_life)} />}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Plot area — single screen with view toggle */}
                  <div className="flex-1 p-4 overflow-auto">
                    <div className="flex flex-col h-full gap-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {VIEW_TABS.map(t => (
                          <button key={t} onClick={() => { setView(t); setQuadView(false) }}
                            className={`px-3 py-1 text-xs rounded border transition-colors ${
                              !quadView && view === t ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                            }`}>{t === 'Probability' ? 'Probability Plot' : t}</button>
                        ))}
                        <button onClick={() => setQuadView(q => !q)}
                          title="Show PDF, CDF, SF and HF together in a 2×2 grid"
                          className={`px-3 py-1 text-xs rounded border transition-colors ${
                            quadView ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                          }`}>Quad view</button>
                        <label
                          className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer text-gray-600 border-gray-200 hover:bg-gray-50"
                          title="Overlay characteristic-life markers (mean, B50, B10, η) on the curve(s)">
                          <input type="checkbox" checked={showSalient}
                            onChange={e => setShowSalient(e.target.checked)} />
                          Salient points
                        </label>
                        <label
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer text-gray-600 border-gray-200 hover:bg-gray-50"
                          title="Overlay right-censored (suspension) times on the curve(s)">
                          <input type="checkbox" checked={showSuspensions}
                            onChange={e => setShowSuspensions(e.target.checked)} />
                          Suspensions
                        </label>
                        <label
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer transition-colors ${
                            !quadView && view === 'PDF' ? 'text-gray-600 border-gray-200 hover:bg-gray-50' : 'text-gray-300 border-gray-100 cursor-not-allowed'
                          }`}
                          title="Overlay a density histogram of the dataset on the PDF curve">
                          <input type="checkbox" checked={showHistogram} disabled={quadView || view !== 'PDF'}
                            onChange={e => setShowHistogram(e.target.checked)} />
                          Histogram
                        </label>
                        <div>
                          <button onClick={downloadCSV}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded">
                            <Download size={12} /> Export CSV
                          </button>
                        </div>
                      </div>
                      {quadView ? (
                        curveSource ? (
                          <QuadGrid src={curveSource as CurveData} build={buildCurveTraces}
                            title={activeDist} units={units} />
                        ) : null
                      ) : view === 'Probability' ? (
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

            {/* Special model results */}
            {specialResult && !fitResult && !folio.specResult && !npResult && (
              <div className="flex-1 overflow-y-auto p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  {SPECIAL_MODELS.find(m => m.value === specialResult.model)?.label ?? specialResult.model}
                </h3>

                {/* Fit metrics */}
                <div className="grid grid-cols-3 gap-3 mb-4 max-w-xl">
                  <div className="rounded-lg border bg-white border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Log-Likelihood</p>
                    <p className="text-lg font-semibold text-gray-900">{fmt(specialResult.loglik)}</p>
                  </div>
                  <div className="rounded-lg border bg-white border-gray-200 p-3">
                    <p className="text-xs text-gray-500">AICc</p>
                    <p className="text-lg font-semibold text-gray-900">{fmt(specialResult.AICc)}</p>
                  </div>
                  <div className="rounded-lg border bg-white border-gray-200 p-3">
                    <p className="text-xs text-gray-500">BIC</p>
                    <p className="text-lg font-semibold text-gray-900">{fmt(specialResult.BIC)}</p>
                  </div>
                </div>

                {/* Parameter table */}
                {specialParams.length > 0 && (
                  <div className="mb-4 max-w-md">
                    <p className="text-xs font-medium text-gray-500 mb-2">Parameters</p>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-200">
                          <th className="text-left py-1 font-medium">Name</th>
                          <th className="text-right py-1 font-medium">Value</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {specialParams.map(p => (
                          <tr key={p.name} className="border-b border-gray-100">
                            <td className="py-1 text-gray-700">{p.name}</td>
                            <td className="py-1 text-right">{fmt(p.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Curves */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {specialSfData.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 360 }}>
                      <Plot
                        data={specialSfData as Plotly.Data[]}
                        layout={{
                          title: { text: 'Survival Function (SF)' },
                          xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                          yaxis: { title: { text: 'SF' }, gridcolor: '#e5e7eb' },
                          margin: { t: 40, r: 20, b: 50, l: 60 },
                          paper_bgcolor: 'white', plot_bgcolor: 'white',
                        } as PlotlyLayout}
                        config={{ responsive: true }}
                        style={{ width: '100%', height: '100%' }}
                        useResizeHandler
                      />
                    </div>
                  )}
                  {specialCdfData.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 360 }}>
                      <Plot
                        data={specialCdfData as Plotly.Data[]}
                        layout={{
                          title: { text: 'Cumulative Distribution Function (CDF)' },
                          xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                          yaxis: { title: { text: 'CDF' }, gridcolor: '#e5e7eb' },
                          margin: { t: 40, r: 20, b: 50, l: 60 },
                          paper_bgcolor: 'white', plot_bgcolor: 'white',
                        } as PlotlyLayout}
                        config={{ responsive: true }}
                        style={{ width: '100%', height: '100%' }}
                        useResizeHandler
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {npResult && !fitResult && !folio.specResult && (
              <div className="flex-1 p-4">
                <Plot
                  data={npPlotData as Plotly.Data[]}
                  layout={{
                    title: { text: `${npResult.method} Estimate` },
                    xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
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
              </div>
            )}

            {weibayesResult && !fitResult && !npResult && !folio.specResult && !specialResult && (
              <div className="flex-1 overflow-y-auto p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  Weibayes Fit (Weibull, fixed β = {fmt(weibayesResult.beta)})
                </h3>

                {/* Fit summary */}
                <div className="grid grid-cols-3 gap-3 mb-4 max-w-xl">
                  <div className="rounded-lg border bg-white border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Characteristic life η</p>
                    <p className="text-lg font-semibold text-gray-900">{fmt(weibayesResult.eta)}</p>
                  </div>
                  <div className="rounded-lg border bg-white border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Failures / Total</p>
                    <p className="text-lg font-semibold text-gray-900">{weibayesResult.r} / {weibayesResult.n_total}</p>
                  </div>
                  <div className="rounded-lg border bg-white border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Assumed β</p>
                    <p className="text-lg font-semibold text-gray-900">{fmt(weibayesResult.beta)}</p>
                  </div>
                </div>

                {/* Parameter table with CI bounds */}
                <div className="mb-4 max-w-md">
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    Parameters ({Math.round(weibayesResult.CI * 100)}% CI)
                  </p>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-200">
                        <th className="text-left py-1 font-medium">Name</th>
                        <th className="text-right py-1 font-medium">Value</th>
                        <th className="text-right py-1 font-medium">Lower</th>
                        <th className="text-right py-1 font-medium">Upper</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      <tr className="border-b border-gray-100">
                        <td className="py-1 text-gray-700">β (fixed)</td>
                        <td className="py-1 text-right">{fmt(weibayesResult.beta)}</td>
                        <td className="py-1 text-right text-gray-400">—</td>
                        <td className="py-1 text-right text-gray-400">—</td>
                      </tr>
                      <tr className="border-b border-gray-100">
                        <td className="py-1 text-gray-700">η</td>
                        <td className="py-1 text-right">{fmt(weibayesResult.eta)}</td>
                        <td className="py-1 text-right">{fmt(weibayesResult.eta_lower)}</td>
                        <td className="py-1 text-right">{fmt(weibayesResult.eta_upper)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {weibayesResult.zero_failure && (
                    <p className="text-[11px] text-amber-600 mt-2">
                      Zero-failure case: η is a conservative lower-bound estimate from the suspension data.
                    </p>
                  )}
                </div>

                {/* View tabs */}
                <div className="flex gap-1 mb-3">
                  {CURVE_TABS.map(t => (
                    <button key={t} onClick={() => setView(t)}
                      className={`px-2.5 py-1 text-xs rounded border ${
                        curveTab === t ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                    >{t}</button>
                  ))}
                </div>

                {/* Curve */}
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
                  <Plot
                    data={weibayesCurveData as Plotly.Data[]}
                    layout={{
                      title: { text: `${curveTab} — Weibayes` },
                      xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: curveTab }, gridcolor: '#e5e7eb' },
                      margin: { t: 40, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      showlegend: true, legend: { x: 0.02, y: 0.98 },
                    } as PlotlyLayout}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              </div>
            )}

            {!fitResult && !npResult && !folio.specResult && !specialResult && !weibayesResult && (
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
