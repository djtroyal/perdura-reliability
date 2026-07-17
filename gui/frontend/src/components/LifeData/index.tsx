import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import Plot from '../shared/ExportablePlot'
import DataGridRow, { type DataRow } from './DataGridRow'
import GroupedDataGrid, {
  type FrequencyDataRow, type IntervalDataRow,
} from './GroupedDataGrid'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play, Download, Plus, Trash2, Upload, X, GitCompare, Dices, Check, Calculator, Pencil, Wand2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import LifeDataWizard from './Wizard'
import StaleBanner from '../shared/StaleBanner'
import Papa from 'papaparse'
import ResultsTable from '../shared/ResultsTable'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import ConfidenceInput from '../shared/ConfidenceInput'
import {
  fitDistributions, fitDistributionsWithProgress, FitProgress,
  fetchDistPlot, fitNonparametric, generateSamples, generateMCEquation,
  fitGroupedDistributions, fetchGroupedDistPlot, fitTurnbull,
  getSpecCurves, compareFolios, calculateMetrics, CalculatorResponse,
  computeStressStrength, fitSpecialModel, fitWeibayes, fitCompetingFailureModes,
  cfmMonteCarlo, calculateCalibratedUncertainty, calculateCalibratedUncertaintyWithProgress,
  FitResponse, NonparametricResponse, SpecCurvesResponse, CompareResponse,
  StressStrengthResponse, SpecialModelResponse, WeibayesResponse,
  CFMResponse, CFMMonteCarloResponse, ConvergenceSeries,
  CalibratedUncertaintyResponse, BootstrapProgress,
  CensoringDesignRequest,
  FrequencyLifeObservation, IntervalLifeObservation, TurnbullResponse,
} from '../../api/client'
import ConvergencePlot from '../shared/ConvergencePlot'
import { useModuleState, useUnits } from '../../store/project'
import NumberField from '../shared/NumberField'
import {
  computeSalientPoints, salientTrace, CurveData, CurveKey,
} from './plotOverlays'

const ALL_DISTS = [
  'Weibull_2P','Weibull_3P','Exponential_1P','Exponential_2P',
  'Normal_2P','Lognormal_2P','Lognormal_3P',
  'Gamma_2P','Gamma_3P','Loglogistic_2P','Loglogistic_3P',
  'Beta_2P','Gumbel_2P',
]

// Special Weibull models fitted via the /life-data/special endpoint
const SPECIAL_MODELS: { value: string; label: string }[] = [
  { value: 'mixture', label: 'Weibull Mixture' },
  { value: 'competing_risks', label: 'Competing Risks' },
  { value: 'dszi', label: 'Defective Subpopulation Zero Inflated (DSZI)' },
  { value: 'ds', label: 'Defective Subpopulation (DS)' },
  { value: 'zi', label: 'Zero Inflated (ZI)' },
]

const INTERVAL_DISTS = [
  'Weibull_2P', 'Exponential_1P', 'Normal_2P', 'Lognormal_2P',
  'Gamma_2P', 'Loglogistic_2P', 'Beta_2P', 'Gumbel_2P',
]

const SPECIAL_MODEL_TIP =
  'Special Weibull models. Mixture: additive combination of 2 distributions ' +
  '(proportions sum to 1). Competing risks: product of survival functions ' +
  '(failure modes competing). DSZI: defective subpopulation (CDF < 1) combined ' +
  'with zero-inflated (dead-on-arrival at t=0). DS: a fraction of the population ' +
  'never fails. ZI: a fraction fails immediately at t=0.'

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

const FIT_COMPARISON_COLORS = [
  '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2',
  '#4f46e5', '#65a30d', '#c026d3', '#ea580c', '#0f766e', '#475569',
]

const CURVE_TABS = ['PDF', 'CDF', 'SF', 'HF'] as const
type CurveTab = typeof CURVE_TABS[number]
const VIEW_TABS = ['Probability', ...CURVE_TABS, 'Q-Q', 'P-P'] as const
type ViewTab = typeof VIEW_TABS[number]


interface MCVariable {
  id: string
  name: string
  distribution: string
  params: Record<string, string>
}

interface SpecState {
  distribution: string
  params: Record<string, string>
  n: string
  seed: string
  includeSuspensions: boolean
  suspensionRate: string
  /** When generating into a folio that already has data: replace or append. */
  genMode: 'replace' | 'append'
  mcMode: 'single' | 'equation'
  mcVariables: MCVariable[]
  mcEquation: string
  /** Optional ID label applied to generated data points (ID column). */
  mcId: string
  /** Convergence diagnostic of the last equation-mode Monte-Carlo run. */
  mcConvergence?: ConvergenceSeries | null
}

interface Folio {
  id: string
  name: string
  rows: DataRow[]
  method: 'MLE' | 'RRX' | 'RRY'
  ci: number
  ciText: string
  selectedDists: string[]
  dataFormat?: 'individual' | 'frequency' | 'interval'
  frequencyRows?: FrequencyDataRow[]
  intervalRows?: IntervalDataRow[]
  analysisMode: 'parametric' | 'nonparametric' | 'special' | 'weibayes' | 'cfm' | 'stressstrength'
  npMethod: 'KM' | 'NA'
  specialModel: string
  weibayesBeta: string
  weibayesUncertaintyMethod?: 'fixed' | 'sensitivity' | 'bayesian'
  weibayesBetaLower?: string
  weibayesBetaUpper?: string
  weibayesBetaSd?: string
  weibayesSamples?: string
  dataSource: 'table' | 'spec'
  spec: SpecState
  selectedDist?: string | null
  setDist?: string | null
  result?: FitResponse | null
  npResult?: NonparametricResponse | null
  turnbullResult?: TurnbullResponse | null
  specResult?: SpecCurvesResponse | null
  specialResult?: SpecialModelResponse | null
  weibayesResult?: WeibayesResponse | null
  cfmResult?: CFMResponse | null
  cfmDist?: string
  cfmReliabilityTime?: string
  cfmMcResult?: CFMMonteCarloResponse | null
  cfmMcSamples?: string
  cfmMcTime?: string
  dataSig?: string | null
  /** Overlay characteristic-life markers (mean, B50, B10, η) on curve plots. */
  showSalient?: boolean
  /** Overlay right-censored (suspension) times on the plots. */
  showSuspensions?: boolean
  /** Show a statistics annotation (fitted params + CI, F/S counts) on plots. */
  showStats?: boolean
  /** Show all successful parametric fits together on a common curve plot. */
  fitComparisonOpen?: boolean
  /** Curve type used by the all-fit comparison. */
  fitComparisonView?: CurveTab
  /** Fitted distributions hidden by the user in the all-fit comparison. */
  fitComparisonHidden?: string[]
  /** Overlay empirical observations in the all-fit comparison. */
  fitComparisonShowData?: boolean
  /** Collapse the fit-ranking table after the user confirms a distribution. */
  fitTableCollapsed?: boolean
  /** Number of sub-populations for the Weibull mixture model (2–4). */
  mixtureSubs?: number
  plotTitleOverrides?: Record<string, string>
  ssStressDist?: string
  ssStrengthDist?: string
  ssStressParams?: Record<string, string>
  ssStrengthParams?: Record<string, string>
  ssResult?: StressStrengthResponse | null
  /** S-S parameter source: 'params' = typed in, 'data' = fit data-table ID groups. */
  ssSource?: 'params' | 'data'
  /** ID-column labels selected as the stress / strength groups (when ssSource='data'). */
  ssStressGroup?: string
  ssStrengthGroup?: string
}

interface CompareState {
  folioIds: string[]
  commonDistribution: string
  commonDistributionManual?: boolean
  commonExpanded?: boolean
  ciText: string
  ci: number
  commonResult?: CompareResponse | null
  commonInputSignature?: string | null
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

interface SelectedCompareModel {
  folioId: string
  name: string
  distribution: string
  source: 'fitted' | 'specified'
  nFailures: number
  nCensored: number
  params: Record<string, number | null>
  logLikelihood: number | null
  AICc: number | null
  BIC: number | null
  AD: number | null
  curves?: SpecCurvesResponse['curves']
  pp?: { theoretical: number[]; empirical: number[] }
  qq?: { theoretical: number[]; empirical: number[] }
}

const folioRowsSignature = (f: Folio) => {
  const format = f.dataFormat ?? 'individual'
  const observations = format === 'frequency'
    ? (f.frequencyRows ?? [])
    : format === 'interval'
      ? (f.intervalRows ?? [])
      : f.rows.map(r => ({ t: r.time, s: r.state }))
  return JSON.stringify({ format, observations })
}

/** Return only a current, explicitly confirmed, eligible parametric model. */
const confirmedComparableDistribution = (f: Folio): string | null => {
  if (f.analysisMode !== 'parametric' || !f.setDist) return null
  if (f.dataSource === 'spec') {
    return f.spec.mcMode === 'single'
      && f.specResult?.distribution === f.setDist
      ? f.setDist : null
  }
  if (!f.result || (f.dataSig != null && f.dataSig !== folioRowsSignature(f))) return null
  const row = f.result.results.find(r => r.Distribution === f.setDist)
  return row?.fit_eligible ? f.setDist : null
}

const fitDiagnosticsSummary = (diagnostics: unknown): string => {
  if (!diagnostics) return 'No optimizer diagnostics were returned.'
  const entries = Array.isArray(diagnostics) ? diagnostics : [diagnostics]
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') return `Attempt ${index + 1}: unavailable`
    const record = entry as Record<string, unknown>
    const parts = [
      record.optimizer ? `optimizer=${String(record.optimizer)}` : null,
      typeof record.converged === 'boolean' ? `converged=${record.converged}` : null,
      record.message ? `message=${String(record.message)}` : null,
      typeof record.gradient_norm === 'number'
        ? `gradient norm=${record.gradient_norm.toPrecision(4)}` : null,
      Array.isArray(record.warnings) && record.warnings.length
        ? `warnings=${record.warnings.join('; ')}` : null,
    ].filter(Boolean)
    return parts.join(', ') || `Attempt ${index + 1}: no diagnostic details`
  }).join(' | ')
}

let keyCounter = 0
const makeKey = () => `k${Date.now().toString(36)}${++keyCounter}`
const newRow = (): DataRow => ({ key: makeKey(), id: '', time: '', state: 'F' })
const newFrequencyRow = (): FrequencyDataRow => ({
  key: makeKey(), id: '', time: '', state: 'F', count: '1',
})
const newIntervalRow = (): IntervalDataRow => ({
  key: makeKey(), id: '', lower: '', upper: '', count: '1',
})

// A small Weibull-ish life dataset (β≈2, η≈120) with two suspensions, so
// "Fit Everything" produces an interesting ranking immediately. Loaded by the
// "Load example" button in the data-table toolbar.
const EXAMPLE_ROWS: { time: string; state: 'F' | 'S' }[] = [
  { time: '31', state: 'F' }, { time: '58', state: 'F' }, { time: '72', state: 'F' },
  { time: '84', state: 'F' }, { time: '96', state: 'F' }, { time: '108', state: 'F' },
  { time: '120', state: 'F' }, { time: '135', state: 'F' }, { time: '152', state: 'F' },
  { time: '178', state: 'F' }, { time: '205', state: 'F' }, { time: '240', state: 'F' },
  { time: '250', state: 'S' }, { time: '250', state: 'S' },
]

const defaultSpec = (): SpecState => ({
  distribution: 'Weibull_2P',
  params: { eta: '100', beta: '2' },
  n: '20',
  seed: '',
  includeSuspensions: false,
  suspensionRate: '20',
  genMode: 'replace',
  mcMode: 'single',
  mcVariables: [
    { id: 'mv1', name: 'A', distribution: 'Normal_2P', params: { mu: '100', sigma: '10' } },
    { id: 'mv2', name: 'B', distribution: 'Normal_2P', params: { mu: '100', sigma: '10' } },
  ],
  mcEquation: 'A + B',
  mcId: '',
})

const makeFolio = (seq: number): Folio => ({
  id: `folio${seq}`,
  name: `Analysis ${seq}`,
  rows: Array.from({ length: 5 }, newRow),
  method: 'MLE',
  ci: 0.95,
  ciText: '0.95',
  selectedDists: ALL_DISTS,
  analysisMode: 'parametric',
  npMethod: 'KM',
  specialModel: 'mixture',
  weibayesBeta: '2.0',
  weibayesUncertaintyMethod: 'fixed',
  weibayesBetaLower: '1.5',
  weibayesBetaUpper: '2.5',
  weibayesBetaSd: '0.25',
  weibayesSamples: '4000',
  cfmDist: 'Weibull_2P',
  cfmReliabilityTime: '',
  dataSource: 'table',
  dataFormat: 'individual',
  frequencyRows: Array.from({ length: 4 }, newFrequencyRow),
  intervalRows: Array.from({ length: 4 }, newIntervalRow),
  spec: defaultSpec(),
  setDist: null,
})

const INITIAL_STATE: LifeDataState = {
  folios: [makeFolio(1)],
  activeId: 'folio1',
  folioSeq: 1,
  compare: {
    folioIds: [], commonDistribution: '', commonDistributionManual: false,
    commonExpanded: false,
    ciText: '0.95', ci: 0.95,
  },
}

const fmt = (v: number | null | undefined) =>
  v == null ? '—'
    : (Math.abs(v) !== 0 && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3))
      ? v.toExponential(3) : v.toFixed(4)

const fmtNum = (v: number | null | undefined) =>
  v == null ? '—' : (Math.abs(v) >= 1e5 ? v.toExponential(3) : v.toFixed(2))

interface EmpiricalLifeContext {
  failureTime: number[]
  failureSF: number[]
  failureCDF: number[]
  suspensionTime: number[]
  suspensionSF: number[]
  suspensionCDF: number[]
}

/** Kaplan-Meier context for common-axis fit comparisons (failures precede
 * censoring when both occur at the same time, as in the standard product-limit
 * estimator). */
function buildEmpiricalLifeContext(failures: number[], rightCensored: number[]): EmpiricalLifeContext {
  const events = new Map<number, { failures: number; censored: number }>()
  for (const time of failures) {
    const event = events.get(time) ?? { failures: 0, censored: 0 }
    event.failures++
    events.set(time, event)
  }
  for (const time of rightCensored) {
    const event = events.get(time) ?? { failures: 0, censored: 0 }
    event.censored++
    events.set(time, event)
  }

  const context: EmpiricalLifeContext = {
    failureTime: [], failureSF: [], failureCDF: [],
    suspensionTime: [], suspensionSF: [], suspensionCDF: [],
  }
  let atRisk = failures.length + rightCensored.length
  let survival = 1
  for (const [time, event] of [...events.entries()].sort((a, b) => a[0] - b[0])) {
    if (event.failures > 0 && atRisk > 0) {
      survival *= 1 - event.failures / atRisk
    }
    for (let i = 0; i < event.failures; i++) {
      context.failureTime.push(time)
      context.failureSF.push(survival)
      context.failureCDF.push(1 - survival)
    }
    for (let i = 0; i < event.censored; i++) {
      context.suspensionTime.push(time)
      context.suspensionSF.push(survival)
      context.suspensionCDF.push(1 - survival)
    }
    atRisk -= event.failures + event.censored
  }
  return context
}

function CalcRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-gray-100 last:border-0 py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-800 font-semibold">{value}</span>
    </div>
  )
}


/** 2×2 grid of PDF / CDF / SF / HF subplots sharing the same overlays (#11). */
function QuadGrid({ src, build, title, units, interactionRevision }: {
  src: CurveData
  build: (s: CurveData, key: CurveKey, label: string) => Record<string, unknown>[]
  title: string
  units: string
  interactionRevision?: unknown
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
    datarevision: title,
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
          interactionRevision={interactionRevision}
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
  // Live per-distribution progress of the streaming fit (null when idle).
  const [fitProgress, setFitProgress] = useState<FitProgress | null>(null)
  const fitAbortRef = useRef<AbortController | null>(null)
  // Show the central progress panel only for multi-distribution fits that
  // have reported at least one completion — tiny jobs finish before a bar
  // is useful and would just flash.
  const showFitProgress = loading && !!fitProgress
    && fitProgress.total >= 3 && fitProgress.done >= 1
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  // Multi-select plot views (Ctrl/Cmd-click to toggle additional plots)
  const [activeViews, setActiveViews] = useState<ViewTab[]>(['Probability'])
  // Overlay a density histogram of the dataset on the PDF curve
  const [showHistogram, setShowHistogram] = useState(false)
  // Salient-point and suspension overlays are persisted per-folio (read below
  // once `folio` is resolved) so the selection survives folio switches/refresh.
  // Quad view: show PDF + CDF + SF + HF in a 2x2 grid (#11)
  const [quadView, setQuadView] = useState(false)
  // Selected-fit comparison is model-preserving; common-family diagnostics
  // are kept in a distinct view because they are temporary refits.
  const [selectedCompareView, setSelectedCompareView] = useState<'P-P' | 'Q-Q' | 'PDF' | 'CDF' | 'SF' | 'HF'>('CDF')
  const [commonCompareView, setCommonCompareView] = useState<'Contours' | 'P-P' | 'Q-Q' | 'PDF' | 'CDF' | 'SF' | 'HF'>('Contours')
  // Quick Reliability Calculator state
  const [calcTime, setCalcTime] = useState('')
  const [calcElapsed, setCalcElapsed] = useState('')
  const [calcRel, setCalcRel] = useState('0.9')
  const [calcBx, setCalcBx] = useState('10')
  const [calcResult, setCalcResult] = useState<CalculatorResponse | null>(null)
  const [calcLoading, setCalcLoading] = useState(false)
  const [uncertaintyMethod, setUncertaintyMethod] = useState<'profile_likelihood' | 'parametric_bootstrap'>('profile_likelihood')
  const [uncertaintyTarget, setUncertaintyTarget] = useState<'reliability' | 'quantile'>('reliability')
  const [uncertaintyValue, setUncertaintyValue] = useState('100')
  const [uncertaintyBootstrapN, setUncertaintyBootstrapN] = useState('200')
  const [uncertaintyCensoringMode, setUncertaintyCensoringMode] = useState<
    'approximate' | 'fixed_administrative' | 'observed_schedule' | 'parametric_independent'
  >('approximate')
  const [uncertaintyCensoringValue, setUncertaintyCensoringValue] = useState('')
  const [uncertaintyCensoringDistribution, setUncertaintyCensoringDistribution] = useState<
    'exponential' | 'weibull' | 'lognormal' | 'uniform'
  >('weibull')
  const [uncertaintyCensoringParameters, setUncertaintyCensoringParameters] = useState('{"shape": 2, "scale": 100}')
  const [uncertaintyResult, setUncertaintyResult] = useState<CalibratedUncertaintyResponse | null>(null)
  const [uncertaintyLoading, setUncertaintyLoading] = useState(false)
  const [uncertaintyProgress, setUncertaintyProgress] = useState<BootstrapProgress | null>(null)
  const uncertaintyAbortRef = useRef<AbortController | null>(null)
  const [uncertaintyError, setUncertaintyError] = useState<string | null>(null)
  const [fitCompareLoading, setFitCompareLoading] = useState(false)
  const [fitCompareError, setFitCompareError] = useState<string | null>(null)
  const fitComparePendingRef = useRef(new Set<string>())
  const fitCompareFailedRef = useRef(new Set<string>())
  const [selectedCompareCurveLoading, setSelectedCompareCurveLoading] = useState(false)
  const [selectedCompareCurveError, setSelectedCompareCurveError] = useState<string | null>(null)
  const selectedCompareCurvePendingRef = useRef(new Set<string>())
  const selectedCompareCurveFailedRef = useRef(new Set<string>())
  useEffect(() => () => {
    fitAbortRef.current?.abort()
    uncertaintyAbortRef.current?.abort()
  }, [])

  // Sort state for the data table (display-only)
  const [ldSortCol, setLdSortCol] = useState<string | null>(null)
  const [ldSortDir, setLdSortDir] = useState<'asc' | 'desc' | null>(null)
  const toggleLdSort = (col: string) => {
    if (ldSortCol !== col) { setLdSortCol(col); setLdSortDir('asc') }
    else if (ldSortDir === 'asc') setLdSortDir('desc')
    else { setLdSortCol(null); setLdSortDir(null) }
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const groupedFileRef = useRef<HTMLInputElement>(null)
  const importFolioRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const folio = state.folios.find(f => f.id === state.activeId) ?? state.folios[0]
  const activeFolioIdRef = useRef(folio.id)
  activeFolioIdRef.current = folio.id
  const isCompare = state.activeId === 'compare'
  // Per-folio overlay toggles (persisted on the folio).
  const showSalient = folio?.showSalient ?? false
  const showSuspensions = folio?.showSuspensions ?? false
  const showStats = folio?.showStats ?? true
  const [cfmView, setCfmView] = useState<'probability' | 'reliability' | 'params' | 'simulation'>('probability')
  // CFM curve panel (Reliability view): which system-curve types are shown, plus
  // quad-view and a per-mode-overlay toggle — mirroring the Parametric panel.
  const [cfmCurveViews, setCfmCurveViews] = useState<Array<'SF' | 'CDF' | 'PDF' | 'HF'>>(['SF'])
  const [cfmQuadView, setCfmQuadView] = useState(false)
  const [cfmShowModes, setCfmShowModes] = useState(true)
  // MC simulation table sort
  const [cfmMcSort, setCfmMcSort] = useState<{ key: 'unit' | 'time' | 'mode' | 'state'; dir: 'asc' | 'desc' }>({ key: 'unit', dir: 'asc' })

  const ldSortedIndices = useMemo(() => {
    const rows = folio?.rows ?? []
    const indices = rows.map((_, i) => i)
    if (!ldSortCol || !ldSortDir) return indices
    return indices.sort((a, b) => {
      let va: string, vb: string
      if (ldSortCol === 'id') { va = String(a); vb = String(b) }
      else if (ldSortCol === 'time') { va = rows[a].time; vb = rows[b].time }
      else { va = rows[a].state; vb = rows[b].state }
      const na = parseFloat(va), nb = parseFloat(vb)
      const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb)
      return ldSortDir === 'asc' ? cmp : -cmp
    })
  }, [folio?.rows, ldSortCol, ldSortDir])

  const toggleView = (t: ViewTab, multi: boolean) => {
    setQuadView(false)
    if (multi) {
      setActiveViews(prev =>
        prev.includes(t)
          ? (prev.length > 1 ? prev.filter(v => v !== t) : prev)
          : [...prev, t])
    } else {
      setActiveViews([t])
    }
  }

  const dataSignature = folioRowsSignature

  // Memoized so the JSON.stringify only re-runs when the rows actually change.
  const currentSig = useMemo(
    () => dataSignature(folio),
    [folio.dataFormat, folio.rows, folio.frequencyRows, folio.intervalRows])
  const hasAnyResult = !!(folio.result || folio.npResult || folio.turnbullResult || folio.specResult || folio.specialResult || folio.weibayesResult || folio.cfmResult)
  const isStale = hasAnyResult && folio.dataSig != null && folio.dataSig !== currentSig

  const setFolio = useCallback((id: string, patch: Partial<Folio> | ((f: Folio) => Partial<Folio>)) =>
    setState(s => ({
      ...s,
      folios: s.folios.map(f => f.id === id
        ? { ...f, ...(typeof patch === 'function' ? patch(f) : patch) } : f),
    })), [setState])

  const patchActive = useCallback((patch: Partial<Folio> | ((f: Folio) => Partial<Folio>)) =>
    setFolio(folio.id, patch), [setFolio, folio.id])

  const [wizardOpen, setWizardOpen] = useState(false)

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
      const hasData = (f.dataFormat ?? 'individual') === 'frequency'
        ? (f.frequencyRows ?? []).some(r => r.time.trim() !== '')
        : (f.dataFormat ?? 'individual') === 'interval'
          ? (f.intervalRows ?? []).some(r => r.lower.trim() !== '' || r.upper.trim() !== '')
          : f.rows.some(r => r.time.trim() !== '')
      const hasResults = !!(f.result || f.npResult || f.turnbullResult || f.specResult || f.specialResult)
      const msg = hasData && !hasResults
        ? `"${f.name}" has data that hasn't been analyzed. Close anyway?`
        : `Close "${f.name}"? Its data and results will be discarded.`
      if (!window.confirm(msg)) return
    }
    setState(s => {
      if (s.folios.length <= 1) return s
      const folios = s.folios.filter(f => f.id !== id)
      const folioIds = s.compare.folioIds.filter(x => x !== id)
      const selectedAfter = folios.filter(candidate => folioIds.includes(candidate.id))
      const confirmedAfter = selectedAfter
        .map(confirmedComparableDistribution)
        .filter((dist): dist is string => dist != null)
      const shared = selectedAfter.length >= 2
        && confirmedAfter.length === selectedAfter.length
        && new Set(confirmedAfter).size === 1
        ? confirmedAfter[0] : ''
      return {
        ...s,
        folios,
        activeId: s.activeId === id ? folios[0].id : s.activeId,
        compare: {
          ...s.compare,
          folioIds,
          commonDistribution: shared,
          commonDistributionManual: false,
          commonResult: null,
          commonInputSignature: null,
        },
      }
    })
  }

  const renameFolio = (id: string) => {
    const f = state.folios.find(x => x.id === id)
    if (!f) return
    const name = window.prompt('Analysis name:', f.name)
    if (name?.trim()) setFolio(id, { name: name.trim() })
  }

  const splitByGroupId = () => {
    const ids = new Map<string, DataRow[]>()
    for (const r of folio.rows) {
      const id = r.id.trim()
      if (!id || !r.time.trim()) continue
      if (!ids.has(id)) ids.set(id, [])
      ids.get(id)!.push(r)
    }
    if (ids.size < 2) return
    setState(s => {
      let seq = s.folioSeq
      const newFolios: Folio[] = []
      for (const [groupId, rows] of ids) {
        seq++
        const padded = [...rows.map(r => ({ ...r, key: makeKey() })), ...Array.from({ length: 3 }, newRow)]
        newFolios.push({
          ...makeFolio(seq),
          name: `${folio.name} — ${groupId}`,
          rows: padded,
          method: folio.method,
          ci: folio.ci,
          ciText: folio.ciText,
          selectedDists: [...folio.selectedDists],
          analysisMode: folio.analysisMode,
        })
      }
      return {
        ...s,
        folios: [...s.folios, ...newFolios],
        activeId: newFolios[0].id,
        folioSeq: seq,
      }
    })
  }

  // --- data table ---

  const updateRow = useCallback((idx: number, field: 'id' | 'time' | 'state', value: string) =>
    patchActive(f => ({
      rows: f.rows.map((r, i) => i === idx ? { ...r, [field]: value } : r),
    })), [patchActive])

  const addRow = useCallback(() => patchActive(f => ({ rows: [...f.rows, newRow()] })), [patchActive])

  const removeRow = useCallback((idx: number) =>
    patchActive(f => f.rows.length <= 1 ? {} : { rows: f.rows.filter((_, i) => i !== idx) }), [patchActive])

  // Row count via ref so the keydown handler stays referentially stable (cell
  // edits don't change it; only add/remove do).
  const rowCountRef = useRef(folio.rows.length)
  rowCountRef.current = folio.rows.length

  // Tab on the last row's Time cell appends a new row (state defaults to F)
  const handleTimeKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Tab' && !e.shiftKey && idx === rowCountRef.current - 1) {
      e.preventDefault()
      addRow()
      setTimeout(() => {
        tableRef.current
          ?.querySelector<HTMLInputElement>(`[data-row="${idx + 1}"][data-col="time"]`)
          ?.focus()
      }, 0)
    }
  }, [addRow])

  const loadRows = (data: DataRow[]) => {
    const padded = data.length < 3
      ? [...data, ...Array.from({ length: 3 - data.length }, newRow)]
      : data
    patchActive({ rows: padded, dataSource: 'table', dataFormat: 'individual' })
  }

  const handleCSV = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const keys = Object.keys(data[0] || {})
        const format = folio.dataFormat ?? 'individual'
        const idKey = keys.find(k => /^id$|^name$|^unit$|^sn$|^serial/i.test(k))
        const countKey = keys.find(k => /count|quantity|qty|frequency|weight/i.test(k))
        if (format === 'frequency') {
          const timeKey = keys.find(k => /value|time|t|failure/i.test(k)) || keys[0]
          const typeKey = keys.find(k => /type|status|state|cens/i.test(k))
          const imported: FrequencyDataRow[] = []
          for (const row of data) {
            const time = row[timeKey]?.trim()
            if (!time || !Number.isFinite(Number(time))) continue
            const rawType = typeKey ? row[typeKey]?.trim().toUpperCase() : 'F'
            imported.push({
              key: makeKey(), id: idKey ? row[idKey]?.trim() ?? '' : '', time,
              state: rawType === 'S' || rawType === 'C' || rawType === '0' ? 'S' : 'F',
              count: countKey ? row[countKey]?.trim() || '1' : '1',
            })
          }
          if (imported.length) patchActive({ frequencyRows: imported })
          return
        }
        if (format === 'interval') {
          const lowerKey = keys.find(k => /lower|start|left|from/i.test(k))
          const upperKey = keys.find(k => /upper|end|right|to/i.test(k))
          if (!lowerKey && !upperKey) {
            setError('Interval CSV needs a lower/start or upper/end column.')
            return
          }
          const imported: IntervalDataRow[] = []
          for (const row of data) {
            const lower = lowerKey ? row[lowerKey]?.trim() ?? '' : ''
            const upper = upperKey ? row[upperKey]?.trim() ?? '' : ''
            if (!lower && !upper) continue
            imported.push({
              key: makeKey(), id: idKey ? row[idKey]?.trim() ?? '' : '', lower, upper,
              count: countKey ? row[countKey]?.trim() || '1' : '1',
            })
          }
          if (imported.length) patchActive({ intervalRows: imported })
          return
        }
        const timeKey = keys.find(k => /value|time|t|failure/i.test(k)) || keys[0]
        const typeKey = keys.find(k => /type|status|state|cens/i.test(k))
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
            f.name = file.name.replace(/\.csv$/i, '') || `Analysis ${seq}`
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

  const folioGroupedData = (f: Folio): {
    observation_model: 'frequency_exact' | 'interval_censored'
    frequency_observations?: FrequencyLifeObservation[]
    interval_observations?: IntervalLifeObservation[]
  } => {
    const format = f.dataFormat ?? 'individual'
    if (format === 'frequency') {
      const observations: FrequencyLifeObservation[] = []
      for (const [index, row] of (f.frequencyRows ?? []).entries()) {
        if (!row.time.trim()) continue
        const time = Number(row.time)
        const count = Number(row.count)
        if (!Number.isFinite(time) || time <= 0) {
          throw new Error(`Frequency row ${index + 1}: time must be greater than 0.`)
        }
        if (!Number.isInteger(count) || count <= 0) {
          throw new Error(`Frequency row ${index + 1}: count must be a positive integer.`)
        }
        observations.push({ id: row.id.trim(), time, state: row.state, count })
      }
      return { observation_model: 'frequency_exact', frequency_observations: observations }
    }
    const observations: IntervalLifeObservation[] = []
    for (const [index, row] of (f.intervalRows ?? []).entries()) {
      const lowerText = row.lower.trim()
      const upperText = row.upper.trim()
      if (!lowerText && !upperText) continue
      const lower = lowerText ? Number(lowerText) : null
      const upper = upperText ? Number(upperText) : null
      const count = Number(row.count)
      if (lower != null && (!Number.isFinite(lower) || lower < 0)) {
        throw new Error(`Interval row ${index + 1}: lower bound must be at least 0.`)
      }
      if (upper != null && (!Number.isFinite(upper) || upper <= 0)) {
        throw new Error(`Interval row ${index + 1}: upper bound must be greater than 0.`)
      }
      if (lower != null && upper != null && lower >= upper) {
        throw new Error(`Interval row ${index + 1}: lower bound must be less than upper.`)
      }
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error(`Interval row ${index + 1}: count must be a positive integer.`)
      }
      observations.push({ id: row.id.trim(), lower, upper, count })
    }
    return { observation_model: 'interval_censored', interval_observations: observations }
  }

  const folioObservationCounts = (f: Folio) => {
    const format = f.dataFormat ?? 'individual'
    if (format === 'individual') {
      const { failures, rc } = folioData(f)
      return { failures: failures.length, censored: rc.length }
    }
    try {
      const grouped = folioGroupedData(f)
      if (grouped.observation_model === 'frequency_exact') {
        return {
          failures: (grouped.frequency_observations ?? [])
            .filter(row => row.state === 'F').reduce((sum, row) => sum + row.count, 0),
          censored: (grouped.frequency_observations ?? [])
            .filter(row => row.state === 'S').reduce((sum, row) => sum + row.count, 0),
        }
      }
      return {
        failures: (grouped.interval_observations ?? [])
          .filter(row => row.upper != null).reduce((sum, row) => sum + row.count, 0),
        censored: (grouped.interval_observations ?? [])
          .filter(row => row.upper == null).reduce((sum, row) => sum + row.count, 0),
      }
    } catch {
      return { failures: 0, censored: 0 }
    }
  }

  // --- analysis actions ---

  const run = async () => {
    const format = folio.dataFormat ?? 'individual'
    const { failures, rc } = folioData(folio)
    if (format === 'individual' && failures.length < 2) {
      setError('Enter at least 2 failure times.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      if (folio.analysisMode === 'parametric' && format !== 'individual') {
        const grouped = folioGroupedData(folio)
        const distributions = folio.selectedDists.filter(distribution =>
          format === 'frequency' || INTERVAL_DISTS.includes(distribution))
        if (distributions.length === 0) {
          throw new Error('Select at least one distribution supported by this grouped format.')
        }
        const res = await fitGroupedDistributions({
          ...grouped,
          distributions_to_fit: distributions,
          CI: folio.ci,
        })
        patchActive({
          result: res, selectedDist: res.best_distribution,
          setDist: null, fitTableCollapsed: false,
          specResult: null, specialResult: null, dataSig: currentSig,
          fitComparisonHidden: [], fitComparisonOpen: false,
        })
        setActiveViews([format === 'interval' ? 'CDF' : 'Probability'])
      } else if (folio.analysisMode === 'parametric') {
        fitAbortRef.current?.abort()
        fitAbortRef.current = new AbortController()
        const res = await fitDistributionsWithProgress({
          failures,
          right_censored: rc.length ? rc : undefined,
          distributions_to_fit: folio.selectedDists.length < ALL_DISTS.length
            ? folio.selectedDists : undefined,
          method: folio.method,
          CI: folio.ci,
        }, setFitProgress, fitAbortRef.current.signal)
        patchActive({
          result: res, selectedDist: res.best_distribution,
          setDist: null, fitTableCollapsed: false,
          specResult: null, specialResult: null, dataSig: currentSig,
          fitComparisonHidden: [], fitComparisonOpen: false,
        })
        setActiveViews(['Probability'])
      } else if (folio.analysisMode === 'nonparametric' && format === 'interval') {
        const grouped = folioGroupedData(folio)
        const res = await fitTurnbull(grouped.interval_observations ?? [])
        patchActive({ turnbullResult: res, npResult: null, dataSig: currentSig })
      } else if (folio.analysisMode === 'nonparametric' && format === 'frequency') {
        throw new Error(
          'Frequency-table nonparametric estimation is not available. Use Parametric MLE or individual observations.')
      } else {
        const res = await fitNonparametric({
          failures,
          right_censored: rc.length ? rc : undefined,
          method: folio.npMethod,
        })
        patchActive({ npResult: res, turnbullResult: null, dataSig: currentSig })
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || (e instanceof Error ? e.message : 'Error running analysis.'))
    } finally {
      setLoading(false)
      setFitProgress(null)
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
        CI: folio.ci,
        n_subpopulations: folio.specialModel === 'mixture' ? (folio.mixtureSubs ?? 2) : undefined,
      })
      patchActive({ specialResult: res, dataSig: currentSig })
      // Mixture renders through the shared plot panel — start on the probability plot.
      if (folio.specialModel === 'mixture') setActiveViews(['Probability'])
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
    const uncertaintyMethod = folio.weibayesUncertaintyMethod ?? 'fixed'
    const betaLower = parseFloat(folio.weibayesBetaLower ?? '')
    const betaUpper = parseFloat(folio.weibayesBetaUpper ?? '')
    const betaSd = parseFloat(folio.weibayesBetaSd ?? '')
    const betaSamples = parseInt(folio.weibayesSamples ?? '4000', 10)
    if (uncertaintyMethod === 'sensitivity'
        && (!isFinite(betaLower) || !isFinite(betaUpper)
          || betaLower <= 0 || betaLower >= beta || betaUpper <= beta)) {
      setError('Sensitivity bounds must be positive and straddle the assumed β.')
      return
    }
    if (uncertaintyMethod === 'bayesian'
        && (!isFinite(betaSd) || betaSd <= 0 || betaSamples < 500)) {
      setError('Bayesian propagation requires β SD > 0 and at least 500 samples.')
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
        uncertainty_method: uncertaintyMethod,
        beta_lower: uncertaintyMethod === 'sensitivity' ? betaLower : undefined,
        beta_upper: uncertaintyMethod === 'sensitivity' ? betaUpper : undefined,
        beta_sd: uncertaintyMethod === 'bayesian' ? betaSd : undefined,
        n_beta_samples: uncertaintyMethod === 'bayesian' ? betaSamples : undefined,
        seed: uncertaintyMethod === 'bayesian' ? 1729 : undefined,
      })
      patchActive({ weibayesResult: res, dataSig: currentSig })
      setActiveViews(['Probability'])
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running Weibayes fit.')
    } finally {
      setLoading(false)
    }
  }

  const runCFM = async () => {
    const items = folio.rows
      .filter(r => r.time.trim() !== '' && !isNaN(parseFloat(r.time)) && parseFloat(r.time) > 0)
      .map(r => ({
        time: parseFloat(r.time),
        mode: r.id.trim() || '__unassigned__',
        state: r.state,
      }))
    const modes = new Set(items.filter(i => i.state === 'F').map(i => i.mode))
    if (modes.size < 2) {
      setError('Competing Failure Modes requires at least 2 distinct failure mode IDs. Use the ID column to assign modes.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const relTime = parseFloat(folio.cfmReliabilityTime ?? '')
      const res = await fitCompetingFailureModes({
        items,
        distribution: folio.cfmDist ?? 'Weibull_2P',
        method: folio.method,
        CI: folio.ci,
        reliability_time: isFinite(relTime) && relTime > 0 ? relTime : undefined,
      })
      patchActive({ cfmResult: res, dataSig: currentSig })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running CFM analysis.')
    } finally {
      setLoading(false)
    }
  }

  // Fit a single distribution to the failure/suspension times of one ID group
  // in the data table, returning the fitted parameters. Used by S-S "from data".
  const fitGroupParams = async (groupId: string, dist: string): Promise<Record<string, number>> => {
    const failures: number[] = []
    const rc: number[] = []
    for (const r of folio.rows) {
      if (r.id.trim() !== groupId) continue
      const t = parseFloat(r.time)
      if (isNaN(t) || t <= 0) continue
      if (r.state === 'S') rc.push(t); else failures.push(t)
    }
    if (failures.length < 2) throw new Error(`Group "${groupId}" needs at least 2 failure times.`)
    const res = await fitDistributions({
      failures, right_censored: rc.length ? rc : undefined,
      distributions_to_fit: [dist], method: folio.method, CI: folio.ci,
    })
    const row = res.results.find(r => r.Distribution === dist)
    if (!row?.params) throw new Error(`Could not fit ${dist} to group "${groupId}".`)
    const params: Record<string, number> = {}
    for (const p of DIST_PARAM_FIELDS[dist] ?? []) {
      const v = row.params[p]
      if (typeof v === 'number') params[p] = v
    }
    if (Object.keys(params).length === 0) throw new Error(`No parameters fitted for group "${groupId}".`)
    return params
  }

  const runStressStrength = async () => {
    setError(null)
    setLoading(true)
    try {
      const stressDist = folio.ssStressDist ?? 'Normal_2P'
      const strengthDist = folio.ssStrengthDist ?? 'Normal_2P'
      let sp: Record<string, number>
      let stp: Record<string, number>
      if (folio.ssSource === 'data') {
        // Fit each ID group to its chosen distribution, then use those params.
        if (!folio.ssStressGroup || !folio.ssStrengthGroup) throw new Error('Select both a stress group and a strength group.')
        sp = await fitGroupParams(folio.ssStressGroup, stressDist)
        stp = await fitGroupParams(folio.ssStrengthGroup, strengthDist)
        // Surface the fitted parameters in the inputs for transparency.
        patchActive({
          ssStressParams: Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, String(v)])),
          ssStrengthParams: Object.fromEntries(Object.entries(stp).map(([k, v]) => [k, String(v)])),
        })
      } else {
        // Iterate over the distribution's expected fields, falling back to the
        // same defaults the inputs display. The stored param objects are only
        // populated once the user edits a field, so on a first run they may be
        // empty — without this fallback the backend rejects the empty params.
        sp = {}
        for (const k of DIST_PARAM_FIELDS[stressDist] ?? []) {
          const raw = (folio.ssStressParams ?? {})[k] ?? PARAM_DEFAULTS[k] ?? ''
          sp[k] = parseFloat(raw); if (isNaN(sp[k])) throw new Error(`Invalid stress param ${k}`)
        }
        stp = {}
        for (const k of DIST_PARAM_FIELDS[strengthDist] ?? []) {
          const raw = (folio.ssStrengthParams ?? {})[k] ?? PARAM_DEFAULTS[k] ?? ''
          stp[k] = parseFloat(raw); if (isNaN(stp[k])) throw new Error(`Invalid strength param ${k}`)
        }
      }
      const res = await computeStressStrength({
        stress_distribution: stressDist, stress_params: sp,
        strength_distribution: strengthDist, strength_params: stp,
      })
      patchActive({ ssResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || (e instanceof Error ? e.message : 'Error computing S-S interference.'))
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
      patchActive({
        specResult: res,
        result: null,
        selectedDist: res.distribution,
        setDist: res.distribution,
      })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing model.')
    } finally {
      setLoading(false)
    }
  }

  // --- Equation MC variable helpers ---
  const mcVarSeq = useRef(10)
  const nextVarName = (): string => {
    const used = new Set(folio.spec.mcVariables.map(v => v.name))
    for (let i = 0; i < 26; i++) {
      const ch = String.fromCharCode(65 + i)
      if (!used.has(ch)) return ch
    }
    return `V${mcVarSeq.current++}`
  }

  const addVariable = () => {
    if (folio.spec.mcVariables.length >= 20) return
    const name = nextVarName()
    const nv: MCVariable = {
      id: `mv${++mcVarSeq.current}`,
      name,
      distribution: 'Normal_2P',
      params: { mu: '100', sigma: '10' },
    }
    patchActive(f => ({
      spec: { ...f.spec, mcVariables: [...f.spec.mcVariables, nv] },
    }))
  }

  const removeVariable = (id: string) => {
    patchActive(f => ({
      spec: { ...f.spec, mcVariables: f.spec.mcVariables.filter(v => v.id !== id) },
    }))
  }

  const updateVariable = (id: string, field: 'name' | 'distribution', value: string) => {
    patchActive(f => ({
      spec: {
        ...f.spec,
        mcVariables: f.spec.mcVariables.map(v => {
          if (v.id !== id) return v
          if (field === 'distribution') {
            const newParams = Object.fromEntries(
              DIST_PARAM_FIELDS[value].map(p => [p, v.params[p] ?? PARAM_DEFAULTS[p]])
            )
            return { ...v, distribution: value, params: newParams }
          }
          return { ...v, [field]: value }
        }),
      },
    }))
  }

  const updateVariableParam = (id: string, param: string, value: string) => {
    patchActive(f => ({
      spec: {
        ...f.spec,
        mcVariables: f.spec.mcVariables.map(v =>
          v.id === id ? { ...v, params: { ...v.params, [param]: value } } : v
        ),
      },
    }))
  }

  const importFromFolio = (varId: string) => {
    const fitted = state.folios
      .filter(f => f.id !== folio.id)
      .map(f => ({ folio: f, fit: folioFittedDist(f) }))
      .filter((x): x is { folio: Folio; fit: { dist: string; params: Record<string, number> } } => x.fit !== null)
    if (fitted.length === 0) { setError('No other analyses have fitted distributions.'); return }
    const list = fitted.map((x, i) => `${i + 1}. ${x.folio.name} — ${x.fit.dist}`).join('\n')
    const choice = window.prompt(`Import fitted distribution from:\n\n${list}\n\nEnter number:`)
    if (!choice) return
    const idx = parseInt(choice, 10) - 1
    if (isNaN(idx) || idx < 0 || idx >= fitted.length) { setError('Invalid selection.'); return }
    const { fit } = fitted[idx]
    const strParams = Object.fromEntries(
      Object.entries(fit.params).map(([k, v]) => [k, String(v)])
    )
    patchActive(f => ({
      spec: {
        ...f.spec,
        mcVariables: f.spec.mcVariables.map(v =>
          v.id === varId ? { ...v, distribution: fit.dist, params: strParams } : v
        ),
      },
    }))
  }

  const generateMonteCarlo = async () => {
    const n = parseInt(folio.spec.n, 10)
    if (isNaN(n) || n < 2 || n > 100000) {
      setError(`Sample count must be 2–${folio.spec.mcMode === 'equation' ? '100,000' : '10,000'}.`)
      return
    }
    if (folio.spec.mcMode === 'single' && (n > 10000)) {
      setError('Sample count must be 2–10,000 in single distribution mode.'); return
    }

    const seed = parseInt(folio.spec.seed, 10)
    const existingRows = folio.rows.filter(r => r.time.trim() !== '')
    const existing = existingRows.length
    const append = folio.spec.genMode === 'append'
    if (existing > 0 && !append) {
      const ok = window.confirm(
        `This analysis already contains ${existing} data point${existing !== 1 ? 's' : ''}. ` +
        `Generating a new dataset will replace the existing data — this cannot be undone.\n\n` +
        `Replace the current data?`
      )
      if (!ok) return
    }
    setError(null)
    setLoading(true)
    try {
      let samples: number[]
      let convergence: ConvergenceSeries | null = null
      if (folio.spec.mcMode === 'equation') {
        const vars = folio.spec.mcVariables.map(v => {
          const numParams: Record<string, number> = {}
          for (const [k, val] of Object.entries(v.params)) {
            const n = parseFloat(val)
            if (isNaN(n)) throw new Error(`Variable "${v.name}" parameter "${k}" is not numeric.`)
            numParams[k] = n
          }
          return { name: v.name, distribution: v.distribution, params: numParams }
        })
        if (!folio.spec.mcEquation.trim()) throw new Error('Equation is empty.')
        const res = await generateMCEquation({
          variables: vars, equation: folio.spec.mcEquation, n,
          seed: isNaN(seed) ? undefined : seed,
        })
        samples = res.samples
        convergence = res.convergence ?? null
      } else {
        const params = specParamsNumeric()
        if (!params) { setLoading(false); return }
        const res = await generateSamples({
          distribution: folio.spec.distribution,
          params, n,
          seed: isNaN(seed) ? undefined : seed,
        })
        samples = res.samples
      }
      const suspRate = folio.spec.includeSuspensions
        ? Math.max(0, Math.min(100, parseFloat(folio.spec.suspensionRate) || 0)) / 100
        : 0
      const mcId = folio.spec.mcId.trim()
      const newRows = samples.map(s => {
        const isSuspension = suspRate > 0 && Math.random() < suspRate
        return {
          key: makeKey(), id: mcId, time: String(s),
          state: (isSuspension ? 'S' : 'F') as 'F' | 'S',
        }
      })
      patchActive(f => ({
        rows: append ? [...f.rows.filter(r => r.time.trim() !== ''), ...newRows] : newRows,
        dataSource: 'table',
        dataFormat: 'individual',
        spec: { ...f.spec, mcConvergence: convergence },
      }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : undefined
      setError(msg || (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error generating samples.')
    } finally {
      setLoading(false)
    }
  }

  const runCommonCompare = async () => {
    const confidence = parseFloat(state.compare.ciText)
    if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
      setError('Confidence level must be between 0 and 1.')
      return
    }
    if (!state.compare.commonDistribution) {
      setError('Choose a common comparison model for the statistical test.')
      return
    }
    const selected = state.folios.filter(f => state.compare.folioIds.includes(f.id))
    if (selected.length < 2) { setError('Select at least 2 analyses to compare.'); return }
    const payload: { name: string; failures: number[]; right_censored?: number[] }[] = []
    for (const f of selected) {
      if ((f.dataFormat ?? 'individual') !== 'individual') {
        setError(
          `Analysis "${f.name}" uses grouped observations. The common-family LR test currently requires individual exact-time data; use Selected Fits Comparison instead.`)
        return
      }
      const { failures, rc } = folioData(f)
      if (failures.length < 2) {
        setError(`Analysis "${f.name}" needs at least 2 failure times.`)
        return
      }
      payload.push({ name: f.name, failures, right_censored: rc.length ? rc : undefined })
    }
    const inputSignature = JSON.stringify({
      folioIds: state.compare.folioIds,
      distribution: state.compare.commonDistribution,
      confidence,
      folios: selected.map(f => ({ id: f.id, name: f.name, data: dataSignature(f) })),
    })
    setError(null)
    setLoading(true)
    try {
      const result = await compareFolios({
        folios: payload,
        distribution: state.compare.commonDistribution,
        CI: confidence,
      })
      setState(s => ({
        ...s,
        compare: {
          ...s.compare,
          ci: confidence,
          commonResult: result,
          commonInputSignature: inputSignature,
        },
      }))
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error comparing analyses.')
    } finally {
      setLoading(false)
    }
  }

  const currentCommonInputSignature = useMemo(() => {
    const selected = state.folios.filter(f => state.compare.folioIds.includes(f.id))
    return JSON.stringify({
      folioIds: state.compare.folioIds,
      distribution: state.compare.commonDistribution,
      confidence: parseFloat(state.compare.ciText),
      folios: selected.map(f => ({ id: f.id, name: f.name, data: dataSignature(f) })),
    })
  }, [state.compare.folioIds, state.compare.commonDistribution,
    state.compare.ciText, state.folios])

  // A common-family result is valid only for the exact datasets and controls
  // that produced it.  Editing an analysis must never leave a stale LR verdict.
  useEffect(() => {
    if (state.compare.commonResult
        && state.compare.commonInputSignature !== currentCommonInputSignature) {
      setState(s => ({
        ...s,
        compare: { ...s.compare, commonResult: null, commonInputSignature: null },
      }))
    }
  }, [currentCommonInputSignature, setState, state.compare.commonInputSignature,
    state.compare.commonResult])

  useEffect(() => {
    selectedCompareCurveFailedRef.current.clear()
    setSelectedCompareCurveError(null)
  }, [state.compare.folioIds])

  // Fill missing selected-model curve arrays from the confirmed parameter
  // estimates.  /spec-curves evaluates those parameters directly, so this
  // does not refit the data or alter the analysis' confirmed distribution.
  useEffect(() => {
    if (!isCompare) return
    const selected = state.folios.filter(f => state.compare.folioIds.includes(f.id))
    const queued: {
      folio: Folio
      distribution: string
      params: Record<string, number>
      key: string
    }[] = []

    for (const candidate of selected) {
      const distribution = confirmedComparableDistribution(candidate)
      if (!distribution || candidate.dataSource !== 'table' || !candidate.result) continue
      if (candidate.result.plots?.[distribution]?.curves) continue
      const fit = candidate.result.results.find(r => r.Distribution === distribution)
      const params: Record<string, number> = {}
      let valid = true
      for (const name of DIST_PARAM_FIELDS[distribution] ?? []) {
        const value = fit?.params?.[name]
        if (value == null || !Number.isFinite(value)) { valid = false; break }
        params[name] = value
      }
      if (!valid) continue
      const key = `${candidate.id}|${candidate.dataSig ?? ''}|${distribution}|${JSON.stringify(params)}`
      if (selectedCompareCurvePendingRef.current.has(key)
          || selectedCompareCurveFailedRef.current.has(key)) continue
      queued.push({ folio: candidate, distribution, params, key })
      selectedCompareCurvePendingRef.current.add(key)
    }

    if (queued.length === 0) {
      setSelectedCompareCurveLoading(selectedCompareCurvePendingRef.current.size > 0)
      return
    }
    setSelectedCompareCurveLoading(true)
    setSelectedCompareCurveError(null)
    for (const request of queued) {
      getSpecCurves(request.distribution, request.params).then(res => {
        setFolio(request.folio.id, current => {
          if (confirmedComparableDistribution(current) !== request.distribution
              || !current.result) return {}
          const existingPlot = current.result.plots?.[request.distribution] ?? {}
          return {
            result: {
              ...current.result,
              plots: {
                ...current.result.plots,
                [request.distribution]: { ...existingPlot, curves: res.curves },
              },
            },
          }
        })
      }).catch(() => {
        selectedCompareCurveFailedRef.current.add(request.key)
        setSelectedCompareCurveError(
          `The curve for ${request.folio.name} (${request.distribution}) could not be loaded.`)
      }).finally(() => {
        selectedCompareCurvePendingRef.current.delete(request.key)
        setSelectedCompareCurveLoading(selectedCompareCurvePendingRef.current.size > 0)
      })
    }
  }, [isCompare, setFolio, state.compare.folioIds, state.folios])

  // --- stress-strength between folios (fitted distributions) ---

  /** Extract an analysis' active fitted or directly specified distribution. */
  const folioFittedDist = (f: Folio): { dist: string; params: Record<string, number> } | null => {
    if (f.dataSource === 'spec' && f.spec.mcMode === 'single'
        && f.setDist === f.spec.distribution) {
      const params: Record<string, number> = {}
      for (const name of DIST_PARAM_FIELDS[f.spec.distribution] ?? []) {
        const value = Number(f.spec.params[name])
        if (!Number.isFinite(value)) return null
        params[name] = value
      }
      if (Object.keys(params).length > 0) return { dist: f.spec.distribution, params }
    }
    if (f.specResult?.distribution && f.specResult.params) {
      return { dist: f.specResult.distribution, params: f.specResult.params }
    }
    const res = f.result
    if (!res) return null
    const dist = f.setDist || res.best_distribution
    if (!dist) return null
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
    if (!stressF || !strengthF) { setError('Select both a stress analysis and a strength analysis.'); return }
    if (stressF.id === strengthF.id) { setError('Stress and strength must be different analyses.'); return }
    const sd = folioFittedDist(stressF)
    if (!sd) { setError(`Analysis "${stressF.name}" has no fitted distribution — run it first.`); return }
    const gd = folioFittedDist(strengthF)
    if (!gd) { setError(`Analysis "${strengthF.name}" has no fitted distribution — run it first.`); return }
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
    const header = 'Distribution,Method,AICc,BIC,AD,LogLik\n'
    const lines = res.results.map(r =>
      `${r.Distribution},${r.method ?? ''},${r.AICc ?? ''},${r.BIC ?? ''},${r.AD ?? ''},${r.LogLik}`
    ).join('\n')
    const blob = new Blob([header + lines], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${folio.name}_fit_results.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // --- quick reliability calculator ---

  const runCalc = async () => {
    const activeModel = folioFittedDist(folio)
    if (!activeModel) return
    const { dist, params: numericParams } = activeModel
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
  const weibayesResult = folio.weibayesResult
  const isWeibayesMode = folio.analysisMode === 'weibayes'
  // Sub-population overlay colors (shared by mixture probability + curve plots).
  const SUB_COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#ec4899']
  // Weibull Mixture (Special) is rendered through the shared parametric plot
  // panel (probability plot + PDF/CDF/SF/HF tabs, quad view) — flagged here.
  const specialResult = folio.specialResult
  const isMixtureMode = folio.analysisMode === 'special'
    && specialResult?.model === 'mixture' && !!specialResult.curves?.x
  const ciPct = Math.round(((isWeibayesMode ? weibayesResult?.CI : fitResult?.CI) ?? folio.ci) * 100)
  const parametricDist = folio.selectedDist ?? fitResult?.best_distribution ?? ''
  const calibratedData = folioData(folio)
  const hasCalibratedCensoring = calibratedData.rc.length > 0
  const runCalibratedUncertainty = async () => {
    const { failures, rc } = folioData(folio)
    const targetValue = parseFloat(uncertaintyValue)
    const nBootstrap = parseInt(uncertaintyBootstrapN, 10)
    if (!parametricDist) {
      setUncertaintyError('Select an eligible fitted distribution first.')
      return
    }
    if (!isFinite(targetValue) || (uncertaintyTarget === 'quantile'
      ? targetValue <= 0 || targetValue >= 1 : targetValue < 0)) {
      setUncertaintyError(uncertaintyTarget === 'quantile'
        ? 'Quantile probability must be between 0 and 1.'
        : 'Mission time must be non-negative.')
      return
    }
    if (uncertaintyMethod === 'parametric_bootstrap'
        && (!Number.isInteger(nBootstrap) || nBootstrap < 20 || nBootstrap > 2000)) {
      setUncertaintyError('Bootstrap replicates must be an integer from 20 to 2,000.')
      return
    }
    setUncertaintyLoading(true)
    setUncertaintyProgress(uncertaintyMethod === 'parametric_bootstrap'
      ? { done: 0, total: nBootstrap } : null)
    setUncertaintyError(null)
    try {
      let censoringDesign: CensoringDesignRequest | undefined
      if (uncertaintyMethod === 'parametric_bootstrap') {
        if (uncertaintyCensoringMode === 'fixed_administrative') {
          const time = parseFloat(uncertaintyCensoringValue)
          if (!isFinite(time) || time <= 0) throw new Error('Administrative censor time must be positive.')
          censoringDesign = { type: 'fixed_administrative', time }
        } else if (uncertaintyCensoringMode === 'observed_schedule') {
          const times = uncertaintyCensoringValue.split(/[\s,]+/)
            .filter(Boolean).map(Number)
          if (times.length !== failures.length + rc.length || times.some(t => !isFinite(t) || t <= 0)) {
            throw new Error(`Enter one positive planned censor time for each of the ${failures.length + rc.length} units.`)
          }
          censoringDesign = { type: 'observed_schedule', times }
        } else if (uncertaintyCensoringMode === 'parametric_independent') {
          let parameters: Record<string, number>
          try {
            parameters = JSON.parse(uncertaintyCensoringParameters) as Record<string, number>
          } catch {
            throw new Error('Censor-distribution parameters must be valid JSON.')
          }
          if (!parameters || typeof parameters !== 'object'
              || Object.values(parameters).some(v => typeof v !== 'number' || !isFinite(v))) {
            throw new Error('Censor-distribution parameters must be finite numeric values.')
          }
          censoringDesign = {
            type: 'parametric_independent',
            distribution: uncertaintyCensoringDistribution,
            parameters,
          }
        }
      }
      const request = {
        distribution: parametricDist,
        failures,
        right_censored: rc.length ? rc : undefined,
        target: uncertaintyTarget,
        target_value: targetValue,
        method: uncertaintyMethod,
        CI: folio.ci,
        n_bootstrap: nBootstrap,
        seed: 1729,
        censoring_design: censoringDesign,
      } as const
      uncertaintyAbortRef.current?.abort()
      uncertaintyAbortRef.current = new AbortController()
      const response = uncertaintyMethod === 'parametric_bootstrap'
        ? await calculateCalibratedUncertaintyWithProgress(
            request, setUncertaintyProgress, uncertaintyAbortRef.current.signal,
          )
        : await calculateCalibratedUncertainty(request)
      setUncertaintyResult(response)
    } catch (e: unknown) {
      setUncertaintyResult(null)
      setUncertaintyError(
        (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
          || (e as { message?: string })?.message || 'Calibrated interval failed.'
      )
    } finally {
      setUncertaintyLoading(false)
      setUncertaintyProgress(null)
    }
  }
  const uncertaintyInputFingerprint = JSON.stringify({
    analysisId: folio.id,
    distribution: parametricDist,
    failures: calibratedData.failures,
    rightCensored: calibratedData.rc,
    target: uncertaintyTarget,
    targetValue: uncertaintyValue,
    method: uncertaintyMethod,
    confidence: folio.ci,
    bootstrapReplicates: uncertaintyBootstrapN,
    censoringMode: uncertaintyCensoringMode,
    censoringValue: uncertaintyCensoringValue,
    censoringDistribution: uncertaintyCensoringDistribution,
    censoringParameters: uncertaintyCensoringParameters,
  })
  useEffect(() => {
    setUncertaintyResult(null)
    setUncertaintyError(null)
  }, [uncertaintyInputFingerprint])
  const fitComparisonOpen = folio.analysisMode === 'parametric'
    && !!fitResult && !!folio.fitComparisonOpen
  const fitComparisonView = folio.fitComparisonView ?? 'CDF'
  const fitComparisonDists = fitResult?.results
    .filter(r => r.fit_eligible)
    .map(r => r.Distribution) ?? []
  const fitComparisonIneligible = fitResult?.results.filter(r => !r.fit_eligible) ?? []
  const fitComparisonHidden = folio.fitComparisonHidden ?? []
  const fitComparisonShowData = folio.fitComparisonShowData ?? true
  const activeDist = isWeibayesMode
    ? (weibayesResult ? `Weibayes (β=${fmt(weibayesResult.beta)})` : 'Weibayes')
    : isMixtureMode
      ? `Weibull Mixture (${specialResult!.sub_curves?.length ?? 2} sub-pop)`
      : folio.analysisMode === 'special'
        ? (specialResult ? (SPECIAL_MODELS.find(m => m.value === specialResult.model)?.label ?? specialResult.model) : '')
        : parametricDist
  const activeFitRow = fitResult?.results.find(r => r.Distribution === parametricDist)
  const activePlot = fitResult?.plots?.[parametricDist] ?? null

  // /fit only ships the best distribution's plot arrays; when the user picks
  // a different distribution in the results table, fetch its plot payload on
  // demand and merge it into the stored result. Skipped when the data grid
  // has changed since the fit (the stale banner asks for a re-run instead).
  const pendingPlotRef = useRef<string | null>(null)
  useEffect(() => {
    if (folio.analysisMode !== 'parametric') return
    if (!fitResult || !parametricDist || activePlot) return
    if (!fitResult.results?.some(r => r.Distribution === parametricDist && r.fit_eligible)) return
    if (folio.dataSig != null && folio.dataSig !== dataSignature(folio)) return
    if (pendingPlotRef.current === parametricDist) return
    pendingPlotRef.current = parametricDist
    const format = folio.dataFormat ?? 'individual'
    const request = format === 'individual'
      ? (() => {
        const { failures, rc } = folioData(folio)
        return fetchDistPlot({
          failures,
          right_censored: rc.length ? rc : undefined,
          distribution: parametricDist,
          method: folio.method,
          CI: fitResult.CI ?? folio.ci,
        })
      })()
      : fetchGroupedDistPlot({
        ...folioGroupedData(folio),
        distribution: parametricDist,
        CI: fitResult.CI ?? folio.ci,
      })
    request.then(res => {
      patchActive({
        result: { ...fitResult, plots: { ...fitResult.plots, [res.distribution]: res.plot } },
      })
    }).catch(() => {
      // Non-fatal: the results table still shows the fit statistics.
    }).finally(() => { pendingPlotRef.current = null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parametricDist, fitResult, activePlot, folio.analysisMode])

  // The fit endpoint includes plot arrays for the best distribution only.
  // When comparison mode opens, fetch the remaining successful fits and merge
  // each response into the folio cache as it arrives so the overlay fills in
  // progressively.  Request keys prevent duplicate work across rerenders.
  useEffect(() => {
    if (!fitComparisonOpen || !fitResult) return
    if (folio.dataSig != null && folio.dataSig !== dataSignature(folio)) return

    const missing = fitComparisonDists.filter(d => !fitResult.plots?.[d]?.curves)
    const requestPrefix = `${folio.id}|${folio.dataSig ?? ''}|${folio.method}|${fitResult.CI}|`
    if (missing.length === 0) {
      const pending = [...fitComparePendingRef.current].some(k => k.startsWith(requestPrefix))
      setFitCompareLoading(pending)
      return
    }

    const format = folio.dataFormat ?? 'individual'
    const { failures, rc } = folioData(folio)
    const grouped = format === 'individual' ? null : folioGroupedData(folio)
    const fitDataSig = folio.dataSig
    const fitMethod = folio.method
    const queued = missing.filter(distribution =>
      !fitComparePendingRef.current.has(`${requestPrefix}${distribution}`)
      && !fitCompareFailedRef.current.has(`${requestPrefix}${distribution}`))
    if (queued.length === 0) return

    setFitCompareError(null)
    for (const distribution of queued) {
      fitComparePendingRef.current.add(`${requestPrefix}${distribution}`)
    }
    setFitCompareLoading(true)

    // Limit refits to three concurrent requests so "Fit Everything" does not
    // saturate the analysis server while still filling the comparison quickly.
    let next = 0
    const worker = async () => {
      while (next < queued.length) {
        const distribution = queued[next++]
        const requestKey = `${requestPrefix}${distribution}`
        try {
          const res = format === 'individual'
            ? await fetchDistPlot({
              failures,
              right_censored: rc.length ? rc : undefined,
              distribution,
              method: fitMethod,
              CI: fitResult.CI ?? folio.ci,
            })
            : await fetchGroupedDistPlot({
              ...grouped!, distribution, CI: fitResult.CI ?? folio.ci,
            })
          setFolio(folio.id, current => {
            if (!current.result || current.dataSig !== fitDataSig || current.method !== fitMethod) return {}
            if (dataSignature(current) !== fitDataSig) return {}
            return {
              result: {
                ...current.result,
                plots: { ...current.result.plots, [res.distribution]: res.plot },
              },
            }
          })
        } catch {
          fitCompareFailedRef.current.add(requestKey)
          if (activeFolioIdRef.current === folio.id) {
            setFitCompareError('One or more fitted curves could not be loaded. You can leave and reopen the view to retry.')
          }
        } finally {
          fitComparePendingRef.current.delete(requestKey)
          if (activeFolioIdRef.current === folio.id) {
            const pending = [...fitComparePendingRef.current].some(k => k.startsWith(requestPrefix))
            setFitCompareLoading(pending)
          }
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, queued.length) }, worker))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitComparisonOpen, fitResult, folio.id, folio.dataSig, folio.method,
    folio.dataFormat, folio.frequencyRows, folio.intervalRows])
  const probSource = isWeibayesMode
    ? (weibayesResult?.probability ?? null)
    : isMixtureMode
      ? (specialResult!.probability ?? null)
      : (activePlot?.probability ?? null)

  // Parsed failures/suspensions of the active folio, keyed on the rows array
  // (which only changes identity when the grid actually changes) so the plot
  // memos below don't rebuild on unrelated folio writes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeData = useMemo(() => {
    const format = folio.dataFormat ?? 'individual'
    if (format === 'individual') return folioData(folio)
    try {
      const grouped = folioGroupedData(folio)
      if (grouped.observation_model === 'frequency_exact') {
        return {
          failures: (grouped.frequency_observations ?? [])
            .filter(row => row.state === 'F').map(row => row.time),
          rc: (grouped.frequency_observations ?? [])
            .filter(row => row.state === 'S').map(row => row.time),
        }
      }
      return {
        failures: (grouped.interval_observations ?? [])
          .filter(row => row.upper != null).map(row => row.upper as number),
        rc: (grouped.interval_observations ?? [])
          .filter(row => row.upper == null && row.lower != null).map(row => row.lower as number),
      }
    } catch {
      return { failures: [], rc: [] }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folio.dataFormat, folio.rows, folio.frequencyRows, folio.intervalRows])
  const activeObservationCounts = useMemo(
    () => folioObservationCounts(folio),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folio.dataFormat, folio.rows, folio.frequencyRows, folio.intervalRows],
  )
  const empiricalLifeContext = useMemo(
    () => buildEmpiricalLifeContext(activeData.failures, activeData.rc),
    [activeData],
  )

  const probPlotData = useMemo<Record<string, unknown>[]>(() => {
    if (!probSource) return []
    const p = probSource as typeof probSource & {
      scatter_counts?: number[]
      censored_times?: number[]
      censored_counts?: number[]
    }
    const traces: Record<string, unknown>[] = []
    if (p.line_upper && p.line_lower) {
      traces.push({ x: p.line_x, y: p.line_upper, mode: 'lines', line: { width: 0 },
        showlegend: false, hoverinfo: 'skip' })
      traces.push({ x: p.line_x, y: p.line_lower, mode: 'lines', name: `${ciPct}% CI`,
        fill: 'tonexty', fillcolor: 'rgba(239,68,68,0.15)', line: { width: 0 }, hoverinfo: 'skip' })
    }
    const scatterCounts = p.scatter_counts ?? p.scatter_x.map(() => 1)
    const isFrequencyPlot = p.scatter_counts != null
    traces.push({ x: p.scatter_x, y: p.scatter_y, mode: 'markers', name: 'Data',
      customdata: isFrequencyPlot ? scatterCounts : undefined,
      marker: {
        color: '#3b82f6',
        size: isFrequencyPlot
          ? scatterCounts.map(count => 6 + Math.min(10, Math.sqrt(count) * 2))
          : 7,
      },
      hovertemplate: isFrequencyPlot
        ? 'Grouped failure<br>x=%{x:.5g}<br>rank=%{y:.5g}<br>count=%{customdata}<extra></extra>'
        : 'Failure<br>x=%{x:.5g}<br>rank=%{y:.5g}<extra></extra>' })
    traces.push({ x: p.line_x, y: p.line_y, mode: 'lines', name: 'Fitted',
      line: { color: '#ef4444', width: 2 } })
    // Overlay right-censored (suspension) times as icons along the x-axis.
    if (showSuspensions) {
      const rc = p.censored_times ?? activeData.rc
      const rcCounts = p.censored_counts ?? rc.map(() => 1)
      if (rc.length > 0) {
        const isFrequencyCensoring = p.censored_counts != null
        const lineXRaw = p.line_x_raw ?? p.line_x
        const lineX = p.line_x
        const px: number[] = []
        for (const t of rc) {
          // Map raw suspension time to the transformed x-axis space.
          let xv: number | null = null
          if (lineXRaw && lineX && lineXRaw.length > 0) {
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
          }
          if (xv != null) px.push(xv)
        }
        if (px.length > 0) {
          const yBottom = Math.min(...p.scatter_y, ...p.line_y)
          traces.push({
            x: px, y: px.map(() => yBottom), mode: 'markers', type: 'scatter',
            name: 'Suspensions',
            customdata: isFrequencyCensoring ? rcCounts : undefined,
            marker: {
              color: 'rgba(107,114,128,0.3)', size: 10, symbol: 'triangle-up',
              line: { color: '#6b7280', width: 1.5 },
            },
            hovertemplate: isFrequencyCensoring
              ? 'Suspension: %{x}<br>count=%{customdata}<extra></extra>'
              : 'Suspension: %{x}<extra></extra>',
          })
        }
      }
    }
    // (Sub-population lines removed per user request — only the combined
    // mixture curve is shown on the probability plot.)
    return traces
  }, [probSource, ciPct, showSuspensions, activeData])

  const _PARAM_NAMES = ['eta', 'alpha', 'beta', 'gamma', 'mu', 'sigma', 'Lambda']
  const selectedParams = useMemo(() => {
    if (isWeibayesMode) {
      if (!weibayesResult || weibayesResult.eta == null) return null
      return {
        dist: activeDist,
        rows: [
          { name: 'beta', value: weibayesResult.beta, se: null as number | null,
            lower: null as number | null, upper: null as number | null },
          { name: 'eta', value: weibayesResult.eta, se: null as number | null,
            lower: weibayesResult.eta_lower, upper: weibayesResult.eta_upper },
        ],
      }
    }
    if (!fitResult) return null
    const row = fitResult.results.find(r => r.Distribution === parametricDist)
    if (!row?.params) return null
    const p = row.params
    const prows = _PARAM_NAMES.filter(n => p[n] != null).map(n => ({
      name: n,
      value: p[n] as number,
      se: (p[`${n}_se`] ?? null) as number | null,
      lower: (p[`${n}_lower`] ?? null) as number | null,
      upper: (p[`${n}_upper`] ?? null) as number | null,
    }))
    return { dist: row.Distribution, rows: prows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeibayesMode, weibayesResult, activeDist, fitResult, parametricDist])

  // Subtitle carries the fitted distribution type (always, when known) plus the
  // full statistics (parameters, F/S counts, CI) when the Statistics toggle is on.
  // The distribution type lives here rather than in the main plot title.
  const statsSubtitle = useMemo(() => {
    const parts: string[] = []
    if (activeDist) parts.push(activeDist)
    if (showStats && selectedParams) {
      const fmt = (v: number) => v >= 1000 || v < 0.01 ? v.toExponential(3) : v.toPrecision(4)
      for (const p of selectedParams.rows) {
        let s = `${p.name}=${fmt(p.value)}`
        if (p.lower != null && p.upper != null) s += ` [${fmt(p.lower)}, ${fmt(p.upper)}]`
        parts.push(s)
      }
      parts.push(`F=${activeObservationCounts.failures} S=${activeObservationCounts.censored}`)
      parts.push(`CI=${ciPct}%`)
    }
    return parts.join(' | ')
  }, [activeDist, showStats, selectedParams, activeObservationCounts, ciPct])

  const probLayout = useMemo(() => probSource ? {
    xaxis: { title: { text: `${probSource.x_label} (${units})` }, gridcolor: '#e5e7eb' },
    yaxis: { title: { text: probSource.y_label }, gridcolor: '#e5e7eb' },
    margin: { t: statsSubtitle ? 60 : 30, r: 20, b: 50, l: 60 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    showlegend: true, legend: { x: 0.02, y: 0.98 },
    datarevision: `${parametricDist}-${showStats}-${showSalient}-${showSuspensions}`,
  } : {}, [probSource, units, statsSubtitle, parametricDist, showStats, showSalient, showSuspensions])

  const primaryView = activeViews[0] ?? 'Probability'
  const curveTab: CurveTab = primaryView === 'Probability' ? 'CDF' : primaryView as CurveTab
  const curveKey = curveTab.toLowerCase() as 'pdf' | 'cdf' | 'sf' | 'hf'
  const weibayesCurveSource = weibayesResult ? (() => {
    const curves = weibayesResult.curves
    const propagatedLower = curves.sf_propagated_lower
    const propagatedUpper = curves.sf_propagated_upper
    if (!propagatedLower || !propagatedUpper) return curves
    return {
      ...curves,
      sf_lower: propagatedLower,
      sf_upper: propagatedUpper,
      cdf_lower: propagatedUpper.map(v => v == null ? null : 1 - v),
      cdf_upper: propagatedLower.map(v => v == null ? null : 1 - v),
    }
  })() : undefined
  const curveSource = isWeibayesMode
    ? (weibayesCurveSource as unknown as CurveData | undefined)
    : isMixtureMode
      ? (specialResult!.curves as unknown as CurveData)
      : (folio.specResult?.curves ?? activePlot?.curves ?? undefined)
  const plotInteractionRevision = folio.dataSource === 'spec'
    ? `${folio.id}|spec|${folio.specResult?.distribution ?? ''}|${JSON.stringify(folio.specResult?.params ?? {})}`
    : `${folio.id}|${folio.analysisMode}|${folio.dataSig ?? ''}|${parametricDist}|${fitResult?.CI ?? folio.ci}`

  const fitComparisonKey = fitComparisonView.toLowerCase() as CurveKey
  const fitComparisonLoaded = fitComparisonDists.filter(d => !!fitResult?.plots?.[d]?.curves)
  const fitComparisonVisible = fitComparisonDists.filter(d => !fitComparisonHidden.includes(d))
  const fitComparisonPlotData = useMemo<Record<string, unknown>[]>(() => {
    if (!fitResult) return []
    const fitted = fitComparisonVisible.flatMap(distribution => {
      const curves = fitResult.plots?.[distribution]?.curves
      if (!curves) return []
      const values = curves[fitComparisonKey]
      if (!values) return []
      const index = fitComparisonDists.indexOf(distribution)
      const isBest = distribution === fitResult.best_distribution
      return [{
        x: curves.x,
        y: values,
        mode: 'lines',
        type: 'scatter',
        name: `${distribution}${isBest ? ' (best)' : ''}`,
        showlegend: false,
        line: {
          color: FIT_COMPARISON_COLORS[index % FIT_COMPARISON_COLORS.length],
          width: isBest ? 3 : 2,
        },
        hovertemplate: `${distribution}<br>Time: %{x:.5g}<br>${fitComparisonView}: %{y:.5g}<extra></extra>`,
      }]
    })
    if (!fitComparisonShowData) return fitted

    const format = folio.dataFormat ?? 'individual'
    if (format === 'interval') {
      let observations: IntervalLifeObservation[] = []
      try {
        observations = folioGroupedData(folio).interval_observations ?? []
      } catch {
        return fitted
      }
      const empirical = fitResult.empirical
      if (!empirical) return fitted
      const empiricalCDFAt = (time: number) => {
        let value = 0
        for (let index = 0; index < empirical.time.length; index += 1) {
          if (empirical.time[index] > time) break
          value = empirical.cdf[index]
        }
        return value
      }
      if (fitComparisonView === 'CDF' || fitComparisonView === 'SF') {
        const intervalContext: Record<string, unknown>[] = []
        observations.forEach((row, index) => {
          if (row.upper != null) {
            const cdf = empiricalCDFAt(row.upper)
            const ordinate = fitComparisonView === 'CDF' ? cdf : 1 - cdf
            intervalContext.push({
              x: [row.lower ?? 0, row.upper], y: [ordinate, ordinate],
              mode: 'lines', type: 'scatter', showlegend: false,
              customdata: [row.count, row.count],
              line: { color: 'rgba(71,85,105,0.5)', width: 5 },
              hovertemplate: `Observed ${row.lower == null ? 'left-censored' : 'interval'} row ${index + 1}<br>count=%{customdata}<extra></extra>`,
            })
            return
          }
          if (row.lower == null) return
          const cdf = empiricalCDFAt(row.lower)
          intervalContext.push({
            x: [row.lower], y: [fitComparisonView === 'CDF' ? cdf : 1 - cdf],
            mode: 'markers', type: 'scatter', showlegend: false,
            customdata: [row.count],
            marker: { color: '#64748b', size: 9, symbol: 'triangle-down-open' },
            hovertemplate: `Right-censored after %{x:.5g}<br>count=%{customdata}<extra></extra>`,
          })
        })
        return [...fitted, {
          x: empirical.time,
          y: fitComparisonView === 'CDF' ? empirical.cdf : empirical.sf,
          mode: 'lines+markers', type: 'scatter',
          name: 'Turnbull NPMLE', showlegend: true,
          line: { color: '#111827', width: 1.5, shape: 'hv' },
          marker: { color: '#111827', size: 6, symbol: 'circle-open' },
          hovertemplate: `Turnbull<br>Time: %{x:.5g}<br>${fitComparisonView}: %{y:.5g}<extra></extra>`,
        }, ...intervalContext]
      }
      const intervalRugs: Record<string, unknown>[] = []
      observations.forEach(row => {
        if (row.upper != null) {
          intervalRugs.push({
            x: [row.lower ?? 0, row.upper], y: [0, 0],
            mode: 'lines', type: 'scatter', showlegend: false,
            customdata: [row.count, row.count],
            line: { color: '#475569', width: 4 },
            hovertemplate: 'Observed interval<br>count=%{customdata}<extra></extra>',
          })
        } else if (row.lower != null) {
          intervalRugs.push({
            x: [row.lower], y: [0], mode: 'markers', type: 'scatter', showlegend: false,
            customdata: [row.count],
            marker: { color: '#64748b', size: 9, symbol: 'triangle-down-open' },
            hovertemplate: 'Right-censored after %{x:.5g}<br>count=%{customdata}<extra></extra>',
          })
        }
      })
      return [...fitted, ...intervalRugs]
    }

    if (format === 'frequency') {
      const contextPlot = activePlot ?? Object.values(fitResult.plots)
        .find(plot => plot.qq && plot.pp)
      const qq = contextPlot?.qq
      const pp = contextPlot?.pp
      if ((fitComparisonView === 'CDF' || fitComparisonView === 'SF') && qq && pp) {
        const counts = qq.counts ?? qq.sample.map(() => 1)
        return [...fitted, {
          x: qq.sample,
          y: fitComparisonView === 'CDF' ? pp.empirical : pp.empirical.map(value => 1 - value),
          mode: 'markers', type: 'scatter', name: 'Weighted empirical points', showlegend: true,
          customdata: counts,
          marker: {
            color: '#111827', symbol: 'circle-open',
            size: counts.map(count => 6 + Math.min(9, Math.sqrt(count) * 2)),
          },
          hovertemplate: `Grouped failure<br>Time: %{x:.5g}<br>${fitComparisonView}: %{y:.5g}<br>count=%{customdata}<extra></extra>`,
        }]
      }
      const observations = (() => {
        try { return folioGroupedData(folio).frequency_observations ?? [] } catch { return [] }
      })()
      return [...fitted, ...observations.map(row => ({
        x: [row.time], y: [0], mode: 'markers', type: 'scatter',
        name: row.state === 'F' ? 'Grouped failure' : 'Grouped suspension',
        showlegend: false, customdata: [row.count],
        marker: {
          color: row.state === 'F' ? '#111827' : '#64748b',
          size: 7 + Math.min(10, Math.sqrt(row.count) * 2),
          symbol: row.state === 'F' ? 'line-ns' : 'triangle-down-open',
        },
        hovertemplate: `${row.state === 'F' ? 'Failure' : 'Suspension'} at %{x:.5g}<br>count=%{customdata}<extra></extra>`,
      }))]
    }

    const suspensionRug = activeData.rc.length > 0 ? {
      x: activeData.rc, y: activeData.rc.map(() => 0),
      mode: 'markers', type: 'scatter', name: 'Right-censored', showlegend: true,
      marker: {
        color: '#64748b', size: 9, symbol: 'triangle-down-open',
        line: { color: '#64748b', width: 1.5 },
      },
      cliponaxis: false,
      hovertemplate: 'Right-censored at %{x:.5g}<extra></extra>',
    } : null

    if (fitComparisonView === 'PDF') {
      const context: Record<string, unknown>[] = [{
        x: activeData.failures,
        type: 'histogram', histnorm: 'probability density',
        nbinsx: Math.max(4, Math.ceil(Math.sqrt(activeData.failures.length))),
        name: 'Observed failures', showlegend: true,
        marker: { color: 'rgba(100,116,139,0.32)', line: { color: 'rgba(71,85,105,0.55)', width: 1 } },
        opacity: 0.65,
        hovertemplate: 'Failure bin<br>Time: %{x}<br>Density: %{y:.5g}<extra></extra>',
      }]
      context.push({
        x: activeData.failures, y: activeData.failures.map(() => 0),
        mode: 'markers', type: 'scatter', name: 'Failure observations', showlegend: false,
        marker: { color: '#334155', size: 10, symbol: 'line-ns' },
        cliponaxis: false,
        hovertemplate: 'Failure at %{x:.5g}<extra></extra>',
      })
      if (suspensionRug) context.push(suspensionRug)
      return [context[0], ...fitted, ...context.slice(1)]
    }

    if (fitComparisonView === 'CDF' || fitComparisonView === 'SF') {
      const isCDF = fitComparisonView === 'CDF'
      const failureY = isCDF ? empiricalLifeContext.failureCDF : empiricalLifeContext.failureSF
      const suspensionY = isCDF ? empiricalLifeContext.suspensionCDF : empiricalLifeContext.suspensionSF
      const context: Record<string, unknown>[] = [{
        x: empiricalLifeContext.failureTime, y: failureY,
        mode: 'markers', type: 'scatter', name: 'Kaplan–Meier failure points', showlegend: true,
        marker: { color: '#111827', size: 7, symbol: 'circle-open', line: { color: '#111827', width: 1.5 } },
        hovertemplate: `Failure<br>Time: %{x:.5g}<br>Empirical ${fitComparisonView}: %{y:.5g}<extra></extra>`,
      }]
      if (empiricalLifeContext.suspensionTime.length > 0) {
        context.push({
          x: empiricalLifeContext.suspensionTime, y: suspensionY,
          mode: 'markers', type: 'scatter', name: 'Right-censored', showlegend: true,
          marker: { color: '#64748b', size: 9, symbol: 'triangle-down-open', line: { color: '#64748b', width: 1.5 } },
          hovertemplate: `Right-censored<br>Time: %{x:.5g}<br>${fitComparisonView}: %{y:.5g}<extra></extra>`,
        })
      }
      return [...fitted, ...context]
    }

    const eventRugs: Record<string, unknown>[] = [{
      x: activeData.failures, y: activeData.failures.map(() => 0),
      mode: 'markers', type: 'scatter', name: 'Observed failures', showlegend: true,
      marker: { color: '#111827', size: 11, symbol: 'line-ns' },
      cliponaxis: false,
      hovertemplate: 'Failure at %{x:.5g}<extra></extra>',
    }]
    if (suspensionRug) eventRugs.push(suspensionRug)
    return [...fitted, ...eventRugs]
  }, [
    fitResult, fitComparisonVisible, fitComparisonKey, fitComparisonDists,
    fitComparisonView, fitComparisonShowData, activeData, empiricalLifeContext,
    activePlot, folio.dataFormat, folio.frequencyRows, folio.intervalRows,
  ])

  const fitComparisonYTitle: Record<CurveTab, string> = {
    PDF: 'Probability density', CDF: 'Cumulative probability',
    SF: 'Survival probability', HF: 'Hazard rate',
  }

  // η override for salient points: prefer the fitted Weibull eta when available.
  const activeEta = (() => {
    if (isWeibayesMode) return weibayesResult?.eta ?? null
    if (!fitResult) return null
    const row = fitResult.results.find(r => r.Distribution === parametricDist)
    const v = row?.params?.eta
    return typeof v === 'number' ? v : null
  })()
  const salientPoints = useMemo(() => showSalient && curveSource
    ? computeSalientPoints(curveSource as CurveData, activeEta)
    : [], [showSalient, curveSource, activeEta])

  // Build the traces for a single distribution curve (used by single & quad views).
  const buildCurveTraces = useCallback((
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
      const { failures } = activeData
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
    const intervalContext = activePlot?.interval
    if (intervalContext && (key === 'cdf' || key === 'sf')) {
      const empirical = intervalContext.turnbull
      traces.push({
        x: empirical.time,
        y: key === 'cdf' ? empirical.cdf : empirical.sf,
        mode: 'lines+markers', type: 'scatter',
        line: { color: '#111827', width: 1.5, shape: 'hv' },
        marker: { color: '#111827', size: 6, symbol: 'circle-open' },
        name: 'Turnbull NPMLE',
        hovertemplate: `Turnbull<br>Time: %{x:.5g}<br>${key.toUpperCase()}: %{y:.5g}<extra></extra>`,
      })
      intervalContext.lower.forEach((lower, index) => {
        const upper = intervalContext.upper[index]
        if (upper == null) {
          if (lower == null) return
          let cdf = 0
          for (let i = 0; i < empirical.time.length; i += 1) {
            if (empirical.time[i] > lower) break
            cdf = empirical.cdf[i]
          }
          traces.push({
            x: [lower], y: [key === 'cdf' ? cdf : 1 - cdf],
            mode: 'markers', type: 'scatter', showlegend: false,
            customdata: [intervalContext.counts[index]],
            marker: { color: '#64748b', size: 9, symbol: 'triangle-down-open' },
            hovertemplate: 'Right-censored after %{x:.5g}<br>count=%{customdata}<extra></extra>',
          })
          return
        }
        const empiricalIndex = empirical.time.findIndex(time => time === upper)
        const cdf = empiricalIndex >= 0 ? empirical.cdf[empiricalIndex] : null
        if (cdf == null) return
        const ordinate = key === 'cdf' ? cdf : 1 - cdf
        traces.push({
          x: [lower ?? 0, upper], y: [ordinate, ordinate],
          mode: 'lines', type: 'scatter', showlegend: false,
          customdata: [intervalContext.counts[index], intervalContext.counts[index]],
          line: { color: 'rgba(71,85,105,0.5)', width: 5 },
          hovertemplate: `Observed ${lower == null ? 'left-censored' : 'interval'} group<br>count=%{customdata}<extra></extra>`,
        })
      })
    }
    if (showSalient && salientPoints.length > 0) {
      const t = salientTrace(salientPoints, src, key)
      if (t) traces.push(t)
    }
    if (showSuspensions && !activePlot?.interval) {
      const { rc } = activeData
      if (rc.length > 0) {
        traces.push({
          x: rc, y: rc.map(() => 0), mode: 'markers', type: 'scatter',
          name: 'Suspensions',
          marker: {
            color: 'rgba(107,114,128,0.3)', size: 10, symbol: 'triangle-up',
            line: { color: '#6b7280', width: 1.5 },
          },
          hovertemplate: 'Suspension: %{x}<extra></extra>',
        })
      }
    }
    // (Sub-population curve overlays removed per user request.)
    return traces
  }, [ciPct, showHistogram, showSalient, showSuspensions, salientPoints, activeData, activePlot])

  const curvePlotData = useMemo(() => curveSource
    ? buildCurveTraces(curveSource as CurveData, curveKey, curveTab)
    : [], [curveSource, curveKey, curveTab, buildCurveTraces])

  const curveLayout: PlotlyLayout = useMemo(() => ({
    xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
    yaxis: { title: { text: curveTab }, gridcolor: '#e5e7eb' },
    margin: { t: statsSubtitle ? 60 : 30, r: 20, b: 50, l: 60 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    datarevision: `${parametricDist}-${showStats}-${showSalient}-${showSuspensions}`,
  }), [units, curveTab, statsSubtitle, parametricDist, showStats, showSalient, showSuspensions])

  const plotTitle = (key: string, defaultTitle: string) =>
    folio.plotTitleOverrides?.[key] ?? `${folio.name} — ${defaultTitle}`

  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [editTitleValue, setEditTitleValue] = useState('')

  const startEditTitle = (key: string) => {
    // Start with an empty box: leaving it empty (or cancelling) reverts the
    // plot to its default title. The current title shows as a placeholder.
    setEditTitleValue('')
    setEditingTitle(key)
  }
  const saveTitle = () => {
    if (editingTitle == null) return
    const overrides = { ...folio.plotTitleOverrides }
    if (editTitleValue.trim()) overrides[editingTitle] = editTitleValue.trim()
    else delete overrides[editingTitle]   // nothing entered → back to default
    patchActive({ plotTitleOverrides: overrides })
    setEditingTitle(null)
  }
  const cancelTitle = () => {
    // Cancelling a rename clears any override → return to the default title.
    if (editingTitle == null) return
    const overrides = { ...folio.plotTitleOverrides }
    delete overrides[editingTitle]
    patchActive({ plotTitleOverrides: overrides })
    setEditingTitle(null)
  }

  // Shared plot panel: probability plot + PDF/CDF/SF/HF curves with view tabs,
  // quad view, and salient/suspension/histogram/statistics overlays. Used by
  // both the parametric fit results and the Weibayes fit results so they look
  // and behave identically.
  const renderPlotPanel = () => (
    <div className="flex-1 p-4 overflow-hidden">
      <div className="flex flex-col h-full gap-3">
        <div className="flex items-center gap-1 flex-wrap">
          {VIEW_TABS.map(t => (
            <button key={t}
              disabled={(folio.dataFormat ?? 'individual') === 'interval'
                && (t === 'Probability' || t === 'Q-Q' || t === 'P-P')}
              title={(folio.dataFormat ?? 'individual') === 'interval'
                && (t === 'Probability' || t === 'Q-Q' || t === 'P-P')
                ? 'Exact-time probability, Q-Q, P-P, and AD diagnostics are not valid for interval-censored observations.'
                : undefined}
              onClick={(e) => {
              patchActive({ fitComparisonOpen: false })
              toggleView(t, e.ctrlKey || e.metaKey)
            }}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                !fitComparisonOpen && !quadView && activeViews.includes(t) ? 'bg-blue-600 text-white border-blue-600'
                  : (folio.dataFormat ?? 'individual') === 'interval'
                    && (t === 'Probability' || t === 'Q-Q' || t === 'P-P')
                    ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}>{t === 'Probability' ? 'Probability Plot' : t}</button>
          ))}
          <button onClick={() => {
            patchActive({ fitComparisonOpen: false })
            setQuadView(q => !q)
          }}
            title="Show PDF, CDF, SF and HF together in a 2×2 grid"
            className={`px-3 py-1 text-xs rounded border transition-colors ${
              !fitComparisonOpen && quadView ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
            }`}>Quad view</button>
          {folio.analysisMode === 'parametric' && fitComparisonDists.length > 1 && (
            <button onClick={() => {
              setQuadView(false)
              if (!fitComparisonOpen) {
                fitCompareFailedRef.current.clear()
                setFitCompareError(null)
              }
              patchActive({ fitComparisonOpen: !fitComparisonOpen })
            }}
              title="Superimpose every fitted distribution on a common time-domain curve"
              className={`flex items-center gap-1 px-3 py-1 text-xs rounded border transition-colors ${
                fitComparisonOpen
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'border-violet-300 text-violet-700 hover:bg-violet-50'
              }`}>
              <GitCompare size={12} /> Compare fits
            </button>
          )}
          {!fitComparisonOpen && (
            <>
              <span className="text-[10px] text-gray-400 ml-0.5 select-none">Ctrl/⌘-click for multiple</span>
              <label
                className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer text-gray-600 border-gray-200 hover:bg-gray-50"
                title="Overlay characteristic-life markers (mean, B50, B10, η) on the curve(s)">
                <input type="checkbox" checked={showSalient}
                  onChange={e => patchActive({ showSalient: e.target.checked })} />
                Salient points
              </label>
              <label
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer text-gray-600 border-gray-200 hover:bg-gray-50"
                title="Overlay right-censored (suspension) times on the curve(s)">
                <input type="checkbox" checked={showSuspensions}
                  onChange={e => patchActive({ showSuspensions: e.target.checked })} />
                Suspensions
              </label>
              <label
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer transition-colors ${
                  !quadView && activeViews.includes('PDF') && (folio.dataFormat ?? 'individual') !== 'interval'
                    ? 'text-gray-600 border-gray-200 hover:bg-gray-50'
                    : 'text-gray-300 border-gray-100 cursor-not-allowed'
                }`}
                title={(folio.dataFormat ?? 'individual') === 'interval'
                  ? 'A failure-time histogram is not valid when event times are known only by interval.'
                  : 'Overlay a density histogram of the dataset on the PDF curve'}>
                <input type="checkbox" checked={showHistogram}
                  disabled={quadView || !activeViews.includes('PDF') || (folio.dataFormat ?? 'individual') === 'interval'}
                  onChange={e => setShowHistogram(e.target.checked)} />
                Histogram
              </label>
              <label
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer transition-colors ${
                  selectedParams ? 'text-gray-600 border-gray-200 hover:bg-gray-50' : 'text-gray-300 border-gray-100 cursor-not-allowed'
                }`}
                title="Show fitted parameters, F/S count, and CI bounds below the plot">
                <input type="checkbox" checked={showStats} disabled={!selectedParams}
                  onChange={e => patchActive({ showStats: e.target.checked })} />
                Statistics
              </label>
            </>
          )}
          <div className={fitComparisonOpen ? 'ml-auto' : ''}>
            <button onClick={downloadCSV}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded">
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>
        {fitComparisonOpen && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-violet-800 mr-1">Common curve</span>
              {CURVE_TABS.map(view => (
                <button key={view} onClick={() => patchActive({ fitComparisonView: view })}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    fitComparisonView === view
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white border-violet-200 text-violet-700 hover:bg-violet-50'
                  }`}>
                  {view}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5 text-[11px]">
                <label className="flex items-center gap-1 text-gray-700 cursor-pointer mr-1"
                  title="Show empirical observations alongside the fitted distributions">
                  <input type="checkbox" checked={fitComparisonShowData}
                    onChange={e => patchActive({ fitComparisonShowData: e.target.checked })}
                    className="rounded text-violet-600" />
                  Dataset context
                </label>
                {fitCompareLoading && <Loader2 size={12} className="animate-spin text-violet-600" />}
                <span className="text-gray-500">
                  Loaded {fitComparisonLoaded.length}/{fitComparisonDists.length}
                </span>
                <button onClick={() => patchActive({ fitComparisonHidden: [] })}
                  className="text-violet-700 hover:underline">All on</button>
                <span className="text-violet-200">|</span>
                <button onClick={() => patchActive({ fitComparisonHidden: [...fitComparisonDists] })}
                  className="text-gray-500 hover:underline">All off</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-24 overflow-y-auto pr-1">
              {fitComparisonDists.map((distribution, index) => {
                const visible = !fitComparisonHidden.includes(distribution)
                const loaded = !!fitResult?.plots?.[distribution]?.curves
                return (
                  <label key={distribution}
                    className={`flex items-center gap-1.5 text-[11px] cursor-pointer ${loaded ? 'text-gray-700' : 'text-gray-400'}`}>
                    <input type="checkbox" checked={visible}
                      onChange={() => patchActive(f => {
                        const hidden = f.fitComparisonHidden ?? []
                        return {
                          fitComparisonHidden: hidden.includes(distribution)
                            ? hidden.filter(d => d !== distribution)
                            : [...hidden, distribution],
                        }
                      })}
                      className="rounded text-violet-600" />
                    <span className="inline-block w-2.5 h-0.5 rounded"
                      style={{ backgroundColor: FIT_COMPARISON_COLORS[index % FIT_COMPARISON_COLORS.length] }} />
                    <span>{distribution}</span>
                    {distribution === fitResult?.best_distribution && (
                      <span className="rounded bg-green-100 text-green-700 px-1 text-[9px] font-semibold">best</span>
                    )}
                  </label>
                )
              })}
            </div>
            <p className="text-[10px] text-gray-500">
              Curves share the same time axis for direct comparison. Probability plots are excluded because each distribution family uses a different transformed axis.
              {fitComparisonIneligible.length > 0 && (
                <span className="ml-1 text-red-600">
                  {fitComparisonIneligible.length} ineligible {fitComparisonIneligible.length === 1 ? 'fit is' : 'fits are'} excluded.
                </span>
              )}
            </p>
            {fitComparisonShowData && (
              <p className="text-[10px] text-slate-600">
                {(folio.dataFormat ?? 'individual') === 'interval'
                  ? fitComparisonView === 'CDF' || fitComparisonView === 'SF'
                    ? `Dataset context: Turnbull interval-censored NPMLE and observed interval segments for empirical ${fitComparisonView}.`
                    : 'Dataset context: observed interval segments; exact-time density and hazard diagnostics are intentionally unavailable.'
                  : (folio.dataFormat ?? 'individual') === 'frequency'
                    ? fitComparisonView === 'CDF' || fitComparisonView === 'SF'
                      ? `Dataset context: count-weighted empirical failure points and suspension markers for ${fitComparisonView}.`
                      : 'Dataset context: count-scaled failure and suspension rugs.'
                    : fitComparisonView === 'PDF'
                      ? 'Dataset context: density histogram and failure/censoring rugs.'
                      : fitComparisonView === 'CDF' || fitComparisonView === 'SF'
                        ? `Dataset context: Kaplan–Meier failure points and censoring markers for empirical ${fitComparisonView}.`
                        : 'Dataset context: failure and censoring rugs (an unsmoothed empirical hazard would be unstable).' }
              </p>
            )}
            {fitCompareError && <p className="text-[10px] text-red-600">{fitCompareError}</p>}
          </div>
        )}
        {!fitComparisonOpen && !quadView && activeViews.length === 1 && (
          <div className="flex items-center gap-1">
            {editingTitle === (activeViews[0] === 'Probability' ? 'prob' : activeViews[0].toLowerCase()) ? (
              <input autoFocus value={editTitleValue} onChange={e => setEditTitleValue(e.target.value)}
                placeholder={`${plotTitle(activeViews[0] === 'Probability' ? 'prob' : activeViews[0].toLowerCase(), activeViews[0] === 'Probability' ? 'Probability Plot' : activeViews[0])} (leave empty to reset)`}
                onBlur={saveTitle} onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') cancelTitle() }}
                className="flex-1 text-xs border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            ) : (
              <button onClick={() => startEditTitle(activeViews[0] === 'Probability' ? 'prob' : activeViews[0].toLowerCase())}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-blue-600" title="Rename plot title">
                <Pencil size={10} /> Rename title
              </button>
            )}
          </div>
        )}
        {fitComparisonOpen ? (
          fitComparisonPlotData.length > 0 ? (
            <div className="flex-1 min-h-0">
              <Plot
                data={fitComparisonPlotData as Plotly.Data[]}
                layout={{
                  xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: fitComparisonYTitle[fitComparisonView] }, gridcolor: '#e5e7eb' },
                  margin: { t: 45, r: 20, b: 50, l: 65 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  title: {
                    text: plotTitle(`fit-comparison-${fitComparisonView.toLowerCase()}`, `All Fitted Distributions — ${fitComparisonView}`),
                    font: { size: 13 },
                  },
                  showlegend: fitComparisonShowData,
                  legend: {
                    x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top',
                    bgcolor: 'rgba(255,255,255,0.82)', bordercolor: '#e5e7eb', borderwidth: 1,
                    font: { size: 10 },
                  },
                  hovermode: 'x unified',
                  datarevision: `${fitComparisonView}-${fitComparisonHidden.join('|')}-${fitComparisonLoaded.length}-${fitComparisonShowData}-${currentSig}`,
                } as any}
                config={{ responsive: true, displayModeBar: true }}
                interactionRevision={`${plotInteractionRevision}|compare|${fitComparisonView}`}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              {fitCompareLoading ? 'Loading fitted curves…' : 'Turn on at least one fitted distribution.'}
            </div>
          )
        ) : quadView ? (
          curveSource ? (
            <QuadGrid src={curveSource as CurveData} build={buildCurveTraces}
              title={activeDist} units={units}
              interactionRevision={`${plotInteractionRevision}|quad`} />
          ) : null
        ) : (
          activeViews.map(v => {
            if (v === 'Probability') {
              if (probPlotData.length === 0) return null
              return (
                // flex-1 min-h-0 wrapper + height:100% Plot is the reliable
                // full-height pattern; `flex:1` directly on <Plot> makes Plotly's
                // autosize miscompute and render in only part of the container.
                <div key={v} className="flex-1 min-h-0">
                  <Plot
                    data={probPlotData as Plotly.Data[]}
                    layout={{ ...probLayout, title: { text: `${plotTitle('prob', 'Probability Plot')}${statsSubtitle ? `<br><sub>${statsSubtitle}</sub>` : ''}`, font: { size: 13 } } } as any}
                    config={{ responsive: true, displayModeBar: true }}
                    interactionRevision={`${plotInteractionRevision}|probability`}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              )
            }
            if (v === 'Q-Q' || v === 'P-P') {
              const src = v === 'Q-Q' ? activePlot?.qq : activePlot?.pp
              if (!src) return null
              const xs = v === 'Q-Q'
                ? (src as { theoretical: number[] }).theoretical
                : (src as { empirical: number[] }).empirical
              const ys = v === 'Q-Q'
                ? (src as { sample: number[] }).sample
                : (src as { fitted: number[] }).fitted
              const lo = v === 'P-P' ? 0 : Math.min(...xs, ...ys)
              const hi = v === 'P-P' ? 1 : Math.max(...xs, ...ys)
              const xTitle = v === 'Q-Q' ? `Fitted quantile (${units})` : 'Empirical probability (median rank)'
              const yTitle = v === 'Q-Q' ? `Observed time (${units})` : 'Fitted CDF'
              const counts = (src as { counts?: number[] }).counts ?? xs.map(() => 1)
              return (
                <div key={v} className="flex-1 min-h-0">
                  <Plot
                    data={[
                      { x: xs, y: ys, mode: 'markers', name: 'Data', customdata: counts,
                        marker: { color: '#3b82f6', size: counts.map(count => 7 + Math.min(9, Math.sqrt(count) * 2)) },
                        hovertemplate: 'x=%{x:.5g}<br>y=%{y:.5g}<br>count=%{customdata}<extra></extra>' },
                      { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Perfect fit',
                        line: { color: '#9ca3af', dash: 'dash' } },
                    ] as Plotly.Data[]}
                    layout={{
                      xaxis: { title: { text: xTitle }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: yTitle }, gridcolor: '#e5e7eb' },
                      margin: { t: 30, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      title: { text: plotTitle(v.toLowerCase(), v === 'Q-Q' ? 'Q-Q Plot' : 'P-P Plot'), font: { size: 13 } },
                      showlegend: false,
                    } as any}
                    config={{ responsive: true }}
                    interactionRevision={`${plotInteractionRevision}|${v}`}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              )
            }
            const ck = v.toLowerCase() as 'pdf' | 'cdf' | 'sf' | 'hf'
            const traces = curveSource
              ? buildCurveTraces(curveSource as CurveData, ck, v)
              : []
            if (traces.length === 0) return null
            return (
              <div key={v} className="flex-1 min-h-0">
                <Plot
                  data={traces as Plotly.Data[]}
                  layout={{
                    xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                    yaxis: { title: { text: v }, gridcolor: '#e5e7eb' },
                    margin: { t: statsSubtitle ? 60 : 30, r: 20, b: 50, l: 60 },
                    paper_bgcolor: 'white', plot_bgcolor: 'white',
                    title: { text: `${plotTitle(v.toLowerCase(), v)}${statsSubtitle ? `<br><sub>${statsSubtitle}</sub>` : ''}`, font: { size: 13 } },
                    showlegend: false,
                    datarevision: `${parametricDist}-${showStats}-${showSalient}-${showSuspensions}`,
                  } as any}
                  config={{ responsive: true }}
                  interactionRevision={`${plotInteractionRevision}|${v}`}
                  style={{ width: '100%', height: '100%' }}
                  useResizeHandler
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  // --- special model plots ---
  // (`specialResult`, `isMixtureMode`, and `SUB_COLORS` are defined above so the
  // shared plot panel can branch on the mixture case.)

  const specialParams = specialResult?.params ?? []
  const specialSfData = (() => {
    if (!specialResult?.curves?.sf || !specialResult.curves.x) return []
    const c = specialResult.curves
    const traces: Record<string, unknown>[] = [
      { x: c.x, y: c.sf, mode: 'lines', name: 'SF (mixture)',
        line: { color: '#3b82f6', width: 2.5 } },
    ]
    return traces
  })()
  const specialCdfData = (() => {
    if (!specialResult?.curves?.cdf || !specialResult.curves.x) return []
    const c = specialResult.curves
    const traces: Record<string, unknown>[] = [
      { x: c.x, y: c.cdf, mode: 'lines', name: 'CDF (mixture)',
        line: { color: '#ef4444', width: 2.5 } },
    ]
    return traces
  })()
  const specialPdfData = (() => {
    if (!specialResult?.curves?.pdf || !specialResult.curves.x) return []
    const c = specialResult.curves
    const traces: Record<string, unknown>[] = [
      { x: c.x, y: c.pdf, mode: 'lines', name: 'PDF (mixture)',
        line: { color: '#10b981', width: 2.5 } },
    ]
    return traces
  })()
  const specialHfData = (() => {
    if (!specialResult?.curves?.hf || !specialResult.curves.x) return []
    const c = specialResult.curves
    return [{ x: c.x, y: c.hf, mode: 'lines', name: 'HF (mixture)',
      line: { color: '#6366f1', width: 2.5 } }]
  })()

  // Weibayes now reuses the shared parametric plot panel (probability plot +
  // PDF/CDF/SF/HF curves with the same overlays); see `weibayesResult` above.

  const npResult = folio.npResult
  const turnbullResult = folio.turnbullResult
  const npPlotData = (() => {
    if (turnbullResult) {
      return [{
        x: turnbullResult.time, y: turnbullResult.sf,
        mode: 'lines+markers', name: 'Turnbull survival NPMLE',
        line: { color: '#3b82f6', width: 2, shape: 'hv' as const },
        marker: { color: '#1d4ed8', size: 6, symbol: 'circle-open' },
      }]
    }
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
    { key: 'method', label: 'Method' },
    { key: 'AICc', label: 'AICc' },
    { key: 'BIC', label: 'BIC' },
    { key: 'AD', label: 'AD' },
    { key: 'LogLik', label: 'Log-Lik' },
    { key: 'status', label: 'Status' },
  ]

  // Each analysis type keeps its own result so switching between the analysis
  // tabs (Parametric / Non-Param / Special / Weibayes / CFM) shows the existing
  // results without re-running. Only the active mode's results are displayed.
  const currentModeHasResult =
    (folio.analysisMode === 'parametric' && (!!fitResult || !!folio.specResult)) ||
    (folio.analysisMode === 'nonparametric' && (!!npResult || !!turnbullResult)) ||
    (folio.analysisMode === 'special' && !!specialResult) ||
    (folio.analysisMode === 'weibayes' && !!weibayesResult) ||
    (folio.analysisMode === 'cfm' && !!folio.cfmResult) ||
    (folio.analysisMode === 'stressstrength' && !!folio.ssResult)


  // --- model-preserving selected-fit comparison ---

  const selectedFolios = state.folios.filter(f => state.compare.folioIds.includes(f.id))
  const selectedConfirmedDistributions = selectedFolios
    .map(confirmedComparableDistribution)
    .filter((distribution): distribution is string => distribution != null)
  const sharedConfirmedDistribution = selectedFolios.length >= 2
    && selectedConfirmedDistributions.length === selectedFolios.length
    && new Set(selectedConfirmedDistributions).size === 1
    ? selectedConfirmedDistributions[0] : null
  const selectedCompareIssues: string[] = []
  const selectedCompareModels: SelectedCompareModel[] = []
  for (const selected of selectedFolios) {
    if (selected.analysisMode !== 'parametric') {
      selectedCompareIssues.push(
        `${selected.name}: the active analysis is not a standard parametric model.`)
      continue
    }
    if (!selected.setDist) {
      selectedCompareIssues.push(
        `${selected.name}: confirm a distribution with “Set as” before comparing.`)
      continue
    }

    const observationCounts = folioObservationCounts(selected)
    if (selected.dataSource === 'spec') {
      if (selected.spec.mcMode !== 'single'
          || selected.specResult?.distribution !== selected.setDist) {
        selectedCompareIssues.push(
          `${selected.name}: show and confirm a directly specified distribution first.`)
        continue
      }
      selectedCompareModels.push({
        folioId: selected.id,
        name: selected.name,
        distribution: selected.setDist,
        source: 'specified',
        nFailures: 0,
        nCensored: 0,
        params: selected.specResult.params,
        logLikelihood: null,
        AICc: null,
        BIC: null,
        AD: null,
        curves: selected.specResult.curves,
      })
      continue
    }

    if (!selected.result) {
      selectedCompareIssues.push(`${selected.name}: run and confirm a parametric fit first.`)
      continue
    }
    if (selected.dataSig != null && selected.dataSig !== dataSignature(selected)) {
      selectedCompareIssues.push(`${selected.name}: its fit is stale; re-run it before comparing.`)
      continue
    }
    const fit = selected.result.results.find(r => r.Distribution === selected.setDist)
    if (!fit) {
      selectedCompareIssues.push(`${selected.name}: its confirmed distribution result is unavailable.`)
      continue
    }
    if (!fit.fit_eligible) {
      selectedCompareIssues.push(
        `${selected.name}: its confirmed distribution is ineligible (${fit.eligibility_reasons.join('; ') || 'fit diagnostics failed'}).`)
      continue
    }
    const plot = selected.result.plots?.[selected.setDist]
    selectedCompareModels.push({
      folioId: selected.id,
      name: selected.name,
      distribution: selected.setDist,
      source: 'fitted',
      nFailures: observationCounts.failures,
      nCensored: observationCounts.censored,
      params: fit.params ?? {},
      logLikelihood: fit.LogLik,
      AICc: fit.AICc,
      BIC: fit.BIC,
      AD: fit.AD,
      curves: plot?.curves,
      pp: plot?.pp
        ? { theoretical: plot.pp.fitted, empirical: plot.pp.empirical }
        : undefined,
      qq: plot?.qq
        ? { theoretical: plot.qq.theoretical, empirical: plot.qq.sample }
        : undefined,
    })
  }
  const selectedComparisonReady = selectedFolios.length >= 2
    && selectedCompareIssues.length === 0
    && selectedCompareModels.length === selectedFolios.length
  const selectedHasPP = selectedCompareModels.some(model => model.pp)
  const selectedHasQQ = selectedCompareModels.some(model => model.qq)

  const selectedFunctionData = (key: 'pdf' | 'cdf' | 'sf' | 'hf') =>
    selectedCompareModels.map((model, i) => ({
      x: model.curves?.x,
      y: model.curves?.[key],
      mode: 'lines',
      name: `${model.name} (${model.distribution})`,
      line: { color: FOLIO_COLORS[i % FOLIO_COLORS.length], width: 2 },
      hovertemplate: `${model.name}<br>${model.distribution}<br>x=%{x:.5g}<br>y=%{y:.5g}<extra></extra>`,
    })).filter(trace => trace.x && trace.y)

  const selectedPPData = (() => {
    const traces: Record<string, unknown>[] = [
      { x: [0, 1], y: [0, 1], mode: 'lines', name: 'Ideal',
        line: { color: '#9ca3af', dash: 'dash', width: 1 }, hoverinfo: 'skip' },
    ]
    selectedCompareModels.forEach((model, i) => {
      if (!model.pp) return
      traces.push({
        x: model.pp.theoretical, y: model.pp.empirical, mode: 'markers',
        name: `${model.name} (${model.distribution})`,
        marker: { color: FOLIO_COLORS[i % FOLIO_COLORS.length], size: 5 },
      })
    })
    return traces
  })()

  const selectedQQData = (() => {
    const all: number[] = []
    selectedCompareModels.forEach(model => {
      if (model.qq) all.push(...model.qq.theoretical, ...model.qq.empirical)
    })
    const lo = Math.min(...all, 0)
    const hi = Math.max(...all, 1)
    const traces: Record<string, unknown>[] = [
      { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Ideal',
        line: { color: '#9ca3af', dash: 'dash', width: 1 }, hoverinfo: 'skip' },
    ]
    selectedCompareModels.forEach((model, i) => {
      if (!model.qq) return
      traces.push({
        x: model.qq.theoretical, y: model.qq.empirical, mode: 'markers',
        name: `${model.name} (${model.distribution})`,
        marker: { color: FOLIO_COLORS[i % FOLIO_COLORS.length], size: 5 },
      })
    })
    return traces
  })()

  const selectedCompareViewData = (): {
    data: Record<string, unknown>[]; xLabel: string; yLabel: string
  } => {
    switch (selectedCompareView) {
      case 'P-P': return { data: selectedPPData, xLabel: 'Fitted CDF', yLabel: 'Empirical CDF' }
      case 'Q-Q': return { data: selectedQQData, xLabel: `Theoretical quantile (${units})`, yLabel: `Observed quantile (${units})` }
      case 'PDF': return { data: selectedFunctionData('pdf'), xLabel: `Time (${units})`, yLabel: 'PDF' }
      case 'CDF': return { data: selectedFunctionData('cdf'), xLabel: `Time (${units})`, yLabel: 'CDF' }
      case 'SF': return { data: selectedFunctionData('sf'), xLabel: `Time (${units})`, yLabel: 'Survival function' }
      case 'HF': return { data: selectedFunctionData('hf'), xLabel: `Time (${units})`, yLabel: 'Hazard function' }
    }
  }

  // --- explicit common-family temporary refits ---

  const commonResult = state.compare.commonResult
  const contourData = (() => {
    if (!commonResult) return []
    const traces: Record<string, unknown>[] = []
    commonResult.folios.forEach((fit, i) => {
      const color = FOLIO_COLORS[i % FOLIO_COLORS.length]
      if (!fit.fit_eligible || !fit.contour) return
      traces.push({
        type: 'contour',
        x: fit.contour.x, y: fit.contour.y, z: fit.contour.nll,
        contours: { start: fit.contour.level, end: fit.contour.level, size: 1,
          coloring: 'lines' },
        showscale: false,
        line: { color, width: 2 },
        name: fit.name,
        showlegend: true,
        hoverinfo: 'skip',
        legendgroup: fit.name,
      })
      if (fit.contour.point[0] != null) {
        traces.push({
          type: 'scatter',
          x: [fit.contour.point[0]], y: [fit.contour.point[1]],
          mode: 'markers', marker: { color, size: 9, symbol: 'x' },
          name: `${fit.name} MLE`, showlegend: false,
          legendgroup: fit.name,
          hovertemplate: `${fit.name}<br>${fit.contour.x_name}=%{x:.4g}<br>${fit.contour.y_name}=%{y:.4g}<extra></extra>`,
        })
      }
    })
    return traces
  })()
  const contourAxes = commonResult?.folios.find(f => f.fit_eligible && f.contour)?.contour

  const commonFunctionData = (key: 'pdf' | 'cdf' | 'sf' | 'hf') => {
    if (!commonResult) return []
    return commonResult.folios.map((f, i) => ({
      x: f.fit_eligible ? f.curves?.x : undefined,
      y: f.fit_eligible ? f.curves?.[key] : undefined,
      mode: 'lines', name: f.name,
      line: { color: FOLIO_COLORS[i % FOLIO_COLORS.length], width: 2 },
    })).filter(t => t.x && t.y)
  }
  const commonPPData = (() => {
    if (!commonResult) return []
    const traces: Record<string, unknown>[] = [
      { x: [0, 1], y: [0, 1], mode: 'lines', name: 'Ideal',
        line: { color: '#9ca3af', dash: 'dash', width: 1 }, hoverinfo: 'skip' },
    ]
    commonResult.folios.forEach((f, i) => {
      if (!f.fit_eligible || !f.pp) return
      traces.push({ x: f.pp.theoretical, y: f.pp.empirical, mode: 'markers', name: f.name,
        marker: { color: FOLIO_COLORS[i % FOLIO_COLORS.length], size: 5 } })
    })
    return traces
  })()
  const commonQQData = (() => {
    if (!commonResult) return []
    const all: number[] = []
    commonResult.folios.forEach(f => {
      if (f.fit_eligible && f.qq) all.push(...f.qq.theoretical, ...f.qq.empirical)
    })
    const lo = Math.min(...all, 0)
    const hi = Math.max(...all, 1)
    const traces: Record<string, unknown>[] = [
      { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Ideal',
        line: { color: '#9ca3af', dash: 'dash', width: 1 }, hoverinfo: 'skip' },
    ]
    commonResult.folios.forEach((f, i) => {
      if (!f.fit_eligible || !f.qq) return
      traces.push({ x: f.qq.theoretical, y: f.qq.empirical, mode: 'markers', name: f.name,
        marker: { color: FOLIO_COLORS[i % FOLIO_COLORS.length], size: 5 } })
    })
    return traces
  })()

  const commonCompareViewData = (): {
    data: Record<string, unknown>[]; xLabel: string; yLabel: string
  } => {
    switch (commonCompareView) {
      case 'P-P': return { data: commonPPData, xLabel: 'Temporary fitted CDF', yLabel: 'Empirical CDF' }
      case 'Q-Q': return { data: commonQQData, xLabel: `Theoretical quantile (${units})`, yLabel: `Empirical quantile (${units})` }
      case 'PDF': return { data: commonFunctionData('pdf'), xLabel: `Time (${units})`, yLabel: 'PDF' }
      case 'CDF': return { data: commonFunctionData('cdf'), xLabel: `Time (${units})`, yLabel: 'CDF' }
      case 'SF': return { data: commonFunctionData('sf'), xLabel: `Time (${units})`, yLabel: 'Survival function' }
      case 'HF': return { data: commonFunctionData('hf'), xLabel: `Time (${units})`, yLabel: 'Hazard function' }
      default: return { data: [], xLabel: '', yLabel: '' }
    }
  }

  useEffect(() => {
    if (selectedCompareView === 'P-P' && !selectedHasPP) setSelectedCompareView('CDF')
    if (selectedCompareView === 'Q-Q' && !selectedHasQQ) setSelectedCompareView('CDF')
  }, [selectedCompareView, selectedHasPP, selectedHasQQ])

  useEffect(() => {
    if (state.compare.commonDistributionManual) return
    const automatic = sharedConfirmedDistribution ?? ''
    if (state.compare.commonDistribution === automatic) return
    setState(s => ({
      ...s,
      compare: {
        ...s.compare,
        commonDistribution: automatic,
        commonResult: null,
        commonInputSignature: null,
      },
    }))
  }, [setState, sharedConfirmedDistribution, state.compare.commonDistribution,
    state.compare.commonDistributionManual])

  // ==========================================================================

  return (
    <div className="flex flex-col h-full">
      {/* Folio tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 pt-1.5 flex items-end gap-1">
        {state.folios.map(f => {
          const fHasResult = !!(f.result || f.npResult || f.turnbullResult || f.specResult || f.specialResult || f.weibayesResult)
          const fStale = fHasResult && f.dataSig != null && f.dataSig !== dataSignature(f)
          return (
          <div key={f.id}
            onClick={() => { setState(s => ({ ...s, activeId: f.id })); setError(null) }}
            onDoubleClick={() => renameFolio(f.id)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t border border-b-0 cursor-pointer select-none transition-colors ${
              state.activeId === f.id
                ? 'bg-gray-50 border-gray-300 text-blue-700 font-medium'
                : 'bg-white border-transparent text-gray-500 hover:text-gray-700'
            }`}
            title={fStale ? 'Data changed since last analysis — re-run to refresh' : 'Double-click to rename'}
          >
            <span className="flex flex-col items-start leading-tight">
              <span>
                {f.name}
                {fStale && <span className="text-amber-500 font-bold">&nbsp;*</span>}
              </span>
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
          )
        })}
        <button onClick={addFolio} title="New analysis"
          className="px-2 py-1.5 text-gray-400 hover:text-blue-600">
          <Plus size={14} />
        </button>
        <button onClick={() => importFolioRef.current?.click()} title="Import CSV as new analysis"
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
          <GitCompare size={12} /> Compare Analyses
        </button>
      </div>

      {isCompare ? (
        /* ================= Compare view ================= */
        <div className="flex flex-1 overflow-hidden">
          <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
            <div>
              <InfoLabel tip="Select two or more analyses. The default comparison uses each analysis' explicitly confirmed eligible distribution and never changes its model.">Analyses to compare</InfoLabel>
              <div className="flex flex-col gap-1">
                {state.folios.map(f => {
                  const counts = folioObservationCounts(f)
                  const confirmedDist = confirmedComparableDistribution(f)
                  const bestCandidate = !f.setDist ? f.result?.best_distribution : null
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
                            const selectedAfter = s.folios.filter(x => newIds.includes(x.id))
                            const confirmedAfter = selectedAfter
                              .map(confirmedComparableDistribution)
                              .filter((dist): dist is string => dist != null)
                            const shared = selectedAfter.length >= 2
                              && confirmedAfter.length === selectedAfter.length
                              && new Set(confirmedAfter).size === 1
                              ? confirmedAfter[0] : ''
                            return {
                              ...s,
                              compare: {
                                ...s.compare,
                                folioIds: newIds,
                                commonDistribution: shared,
                                commonDistributionManual: false,
                                commonResult: null,
                                commonInputSignature: null,
                              },
                            }
                          })
                        }}
                        className="rounded text-blue-600 mt-0.5" />
                      <span className="flex flex-col leading-tight">
                        <span>
                          {f.name}
                          <span className="text-gray-400"> ({counts.failures}F {counts.censored}S)</span>
                        </span>
                        {(confirmedDist || f.setDist || bestCandidate) && (
                          <span className={`text-[10px] flex items-center gap-0.5 ${confirmedDist ? 'text-green-600' : 'text-amber-600'}`}>
                            {confirmedDist && <Check size={8} />}
                            {confirmedDist
                              ? `${confirmedDist} — confirmed`
                              : f.setDist
                                ? `${f.setDist} — unavailable/stale`
                                : `${bestCandidate} — candidate, not confirmed`}
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="rounded border border-blue-200 bg-blue-50/50 p-2.5">
              <p className="text-xs font-semibold text-blue-800">Selected Fits Comparison</p>
              <p className="text-[10px] text-blue-700 mt-1 leading-snug">
                Uses each analysis&apos; confirmed model as-is. No distribution is substituted,
                and source analyses are not changed.
              </p>
            </div>

            <div className="border border-gray-200 rounded">
              <button
                onClick={() => setState(s => ({
                  ...s,
                  compare: { ...s.compare, commonExpanded: !s.compare.commonExpanded },
                }))}
                className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                {state.compare.commonExpanded
                  ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Common-Family Statistical Test
              </button>
              {state.compare.commonExpanded && (
                <div className="border-t border-gray-200 p-2.5 flex flex-col gap-3">
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 leading-snug">
                    This optional test temporarily re-fits every dataset with one common
                    family. It does not change the confirmed source models. Its conclusion
                    is conditional on that family being appropriate for every dataset.
                  </p>
                  <div>
                    <InfoLabel tip="Family used only for temporary common-family fits and the pooled-versus-separate likelihood-ratio test. It does not replace any confirmed analysis model.">Common comparison model</InfoLabel>
                    <select
                      value={state.compare.commonDistribution}
                      onChange={e => setState(s => ({
                        ...s,
                        compare: {
                          ...s.compare,
                          commonDistribution: e.target.value,
                          commonDistributionManual: e.target.value !== '',
                          commonResult: null,
                          commonInputSignature: null,
                        },
                      }))}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">— choose intentionally —</option>
                      {ALL_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    {sharedConfirmedDistribution
                        && state.compare.commonDistribution === sharedConfirmedDistribution ? (
                      <p className="text-[10px] text-green-600 mt-1 flex items-center gap-1">
                        <Check size={9} /> Matches every selected analysis.
                      </p>
                    ) : selectedFolios.length >= 2 && !sharedConfirmedDistribution ? (
                      <p className="text-[10px] text-amber-600 mt-1">
                        Selected analyses use different models; this choice is a temporary assumption.
                      </p>
                    ) : null}
                    <p className="text-[10px] text-gray-400 mt-1">
                      Likelihood contours are available only for two-parameter families.
                    </p>
                  </div>
                  <div>
                    <InfoLabel tip="Confidence level for the temporary joint likelihood contours and the LR-test significance level (e.g. 0.95 = 95%).">Confidence level</InfoLabel>
                    <ConfidenceInput value={state.compare.ciText}
                      onChange={ciText => setState(s => ({
                        ...s,
                        compare: {
                          ...s.compare, ciText,
                          commonResult: null, commonInputSignature: null,
                        },
                      }))}
                      onCommit={ci => setState(s => ({
                        ...s,
                        compare: {
                          ...s.compare, ci,
                          commonResult: null, commonInputSignature: null,
                        },
                      }))}
                      className="w-full" />
                  </div>
                  <button onClick={runCommonCompare}
                    disabled={loading || !state.compare.commonDistribution}
                    className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
                    <GitCompare size={13} />
                    {loading ? 'Running temporary fits...' : 'Run Common-Family Test'}
                  </button>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

            {/* Stress-Strength between analyses */}
            <div className="border-t border-gray-200 pt-3 flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-700">Stress-Strength Interference</p>
              <p className="text-[10px] text-gray-400 leading-snug">
                Designate one fitted analysis as the stress distribution and another as strength.
                P(failure) = P(stress &gt; strength).
              </p>
              {(() => {
                const fitted = state.folios.filter(f => folioFittedDist(f) != null)
                if (fitted.length < 2) {
                  return (
                    <p className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded">
                      At least 2 analyses with fitted distributions are required.
                      Run each analysis first.
                    </p>
                  )
                }
                return (
                  <>
                    <div>
                      <InfoLabel tip="Select the analysis whose fitted distribution represents the applied stress" className="text-[10px] text-gray-500 mb-0.5">Stress analysis</InfoLabel>
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
                      <InfoLabel tip="Select the analysis whose fitted distribution represents the material or component strength" className="text-[10px] text-gray-500 mb-0.5">Strength analysis</InfoLabel>
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
            <section className="mb-8">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-800">Selected Fits Comparison</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Descriptive, model-preserving comparison of each analysis&apos; confirmed distribution.
                  </p>
                </div>
                <span className="text-[10px] text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-1 whitespace-nowrap">
                  Source models unchanged
                </span>
              </div>

              {selectedFolios.length < 2 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-gray-400">
                  <p className="text-sm font-medium">Select at least two analyses</p>
                  <p className="text-xs mt-1">Each analysis must have an explicitly confirmed eligible fit.</p>
                </div>
              ) : selectedCompareIssues.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-800">Selected fits are not ready</p>
                  <ul className="list-disc ml-5 mt-2 space-y-1 text-xs text-amber-700">
                    {selectedCompareIssues.map(issue => <li key={issue}>{issue}</li>)}
                  </ul>
                </div>
              ) : selectedComparisonReady ? (
                <>
                  <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Analysis</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Confirmed distribution</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Parameters</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">n (F/S)</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">Log-Lik</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">AICc</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">BIC</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">AD</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCompareModels.map((model, i) => (
                          <tr key={model.folioId} className="border-t border-gray-100">
                            <td className="px-3 py-2 font-medium"
                              style={{ color: FOLIO_COLORS[i % FOLIO_COLORS.length] }}>
                              {model.name}
                            </td>
                            <td className="px-3 py-2 font-mono">{model.distribution}</td>
                            <td className="px-3 py-2 font-mono text-[10px] whitespace-nowrap">
                              {(DIST_PARAM_FIELDS[model.distribution] ?? []).map(name =>
                                `${name}=${fmt(model.params[name])}`).join(', ') || '—'}
                            </td>
                            <td className="px-3 py-2 text-right">{model.nFailures}/{model.nCensored}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(model.logLikelihood)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(model.AICc)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(model.BIC)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(model.AD)}</td>
                            <td className="px-3 py-2 text-right">
                              <span className="text-green-700 bg-green-50 rounded px-1.5 py-0.5">
                                {model.source === 'specified' ? 'Specified' : 'Confirmed'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-gray-500 -mt-2 mb-4">
                    Log-likelihood, AICc, BIC, and AD describe each model on its own dataset;
                    do not rank different analyses by comparing these values across datasets.
                  </p>

                  <div className="flex items-center gap-1 mb-2 flex-wrap">
                    {(['P-P', 'Q-Q', 'PDF', 'CDF', 'SF', 'HF'] as const).map(view => {
                      const disabled = (view === 'P-P' && !selectedHasPP)
                        || (view === 'Q-Q' && !selectedHasQQ)
                      return (
                        <button key={view} disabled={disabled}
                          onClick={() => setSelectedCompareView(view)}
                          title={disabled ? 'This diagnostic requires an analysis fitted to observed data.' : undefined}
                          className={`px-3 py-1 text-xs rounded border transition-colors ${
                            selectedCompareView === view
                              ? 'bg-blue-600 text-white border-blue-600'
                              : disabled
                                ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                : 'border-gray-300 text-gray-600'
                          }`}>
                          {view}
                        </button>
                      )
                    })}
                    {selectedCompareCurveLoading && (
                      <span className="ml-2 text-[10px] text-blue-600 flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Loading confirmed curves…
                      </span>
                    )}
                  </div>
                  {selectedCompareCurveError && (
                    <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded mb-2">
                      {selectedCompareCurveError}
                    </p>
                  )}
                  {(() => {
                    const viewData = selectedCompareViewData()
                    return (
                      <>
                        <p className="text-xs text-gray-400 mb-2">
                          {selectedCompareView === 'P-P' || selectedCompareView === 'Q-Q'
                            ? 'Diagnostics are shown only for data-backed fits; directly specified models have no empirical points.'
                            : `Confirmed ${selectedCompareView} curves are overlaid without substituting model families.`}
                        </p>
                        <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 460 }}>
                          <Plot
                            data={viewData.data as Plotly.Data[]}
                            layout={{
                              xaxis: { title: { text: viewData.xLabel }, gridcolor: '#e5e7eb' },
                              yaxis: { title: { text: viewData.yLabel }, gridcolor: '#e5e7eb' },
                              margin: { t: 20, r: 20, b: 50, l: 60 },
                              paper_bgcolor: 'white', plot_bgcolor: 'white',
                              showlegend: true,
                              legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                            } as PlotlyLayout}
                            config={{ responsive: true }}
                            style={{ width: '100%', height: '100%' }}
                            useResizeHandler
                          />
                        </div>
                      </>
                    )
                  })()}
                </>
              ) : null}
            </section>

            {/* Stress-Strength result (analysis-based) */}
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

            {commonResult && (
              <section className="border-t border-gray-200 pt-6">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h2 className="text-base font-semibold text-gray-800">Common-Family Statistical Test</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Temporary {commonResult.distribution} refits at {Math.round(commonResult.CI * 100)}% confidence;
                      confirmed source models remain unchanged.
                    </p>
                  </div>
                  <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-1 whitespace-nowrap">
                    Conditional temporary model
                  </span>
                </div>

                {commonResult.lr_test ? (
                  <div className={`rounded-lg border p-4 mb-5 ${
                    commonResult.lr_test.different
                      ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                    <p className="text-sm font-semibold text-gray-800">
                      Likelihood-Ratio Test — {commonResult.lr_test.different
                        ? 'datasets differ under the common-family assumption'
                        : 'no significant difference detected under the common-family assumption'}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      Pooled {commonResult.distribution} model vs separate temporary fits:
                      {' '}χ² = {commonResult.lr_test.statistic} (df = {commonResult.lr_test.df}),
                      p-value = {commonResult.lr_test.p_value}
                      {' '}{commonResult.lr_test.different ? '<' : '≥'} α = {commonResult.lr_test.alpha}.
                    </p>
                    <p className="text-[10px] text-gray-500 mt-1">
                      This result does not establish that {commonResult.distribution} is an adequate model;
                      review the diagnostics below.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-5">
                    <p className="text-sm font-semibold text-red-800">
                      Likelihood-ratio verdict withheld
                    </p>
                    <p className="text-xs text-red-700 mt-1">
                      The statistic is not valid because one or more temporary fits failed eligibility checks.
                    </p>
                    <ul className="list-disc ml-5 mt-2 space-y-1 text-xs text-red-700">
                      {commonResult.test_reasons.map(reason => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                )}

                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  Temporary fit diagnostics ({commonResult.distribution})
                </h3>
                <div className="overflow-x-auto border border-gray-200 rounded-lg mb-3">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Analysis</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">n (F/S)</th>
                        {commonResult.param_names.map(p => (
                          <th key={p} className="px-3 py-2 text-right font-medium text-gray-600">
                            {p} [CI]
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Log-Lik</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">AICc</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">BIC</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">AD</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Eligibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commonResult.folios.map((fit, i) => (
                        <tr key={fit.name}
                          title={[
                            ...fit.eligibility_reasons,
                            fitDiagnosticsSummary(fit.diagnostics),
                          ].filter(Boolean).join(' | ')}
                          className={`border-t border-gray-100 ${!fit.fit_eligible ? 'bg-red-50' : ''}`}>
                          <td className="px-3 py-1.5 font-medium"
                            style={{ color: FOLIO_COLORS[i % FOLIO_COLORS.length] }}>
                            {fit.name}
                          </td>
                          <td className="px-3 py-1.5 text-right">{fit.n_failures}/{fit.n_censored}</td>
                          {commonResult.param_names.map(p => (
                            <td key={p} className="px-3 py-1.5 text-right font-mono">
                              {fmt(fit.params[p])}
                              <span className="text-gray-400">
                                {' '}[{fmt(fit.params[`${p}_lower`])}, {fmt(fit.params[`${p}_upper`])}]
                              </span>
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(fit.log_likelihood)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(fit.AICc)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(fit.BIC)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(fit.AD)}</td>
                          <td className={`px-3 py-1.5 text-right font-medium ${
                            fit.fit_eligible ? 'text-green-700' : 'text-red-700'}`}>
                            <span className="block">{fit.fit_eligible ? 'Eligible' : 'Ineligible'}</span>
                            <span className="block text-[9px] font-normal text-gray-500">
                              {fit.converged ? 'converged' : 'not converged'} · hover for diagnostics
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {commonResult.pooled_fit && (
                  <p title={fitDiagnosticsSummary(commonResult.pooled_fit.diagnostics)}
                    className={`text-xs rounded p-2 mb-5 ${
                    commonResult.pooled_fit.fit_eligible
                      ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                    <span className="font-semibold">Pooled temporary fit:</span>{' '}
                    {commonResult.pooled_fit.fit_eligible ? 'Eligible' : 'Ineligible'};
                    {' '}Log-Lik {fmt(commonResult.pooled_fit.log_likelihood)},
                    {' '}AICc {fmt(commonResult.pooled_fit.AICc)},
                    {' '}BIC {fmt(commonResult.pooled_fit.BIC)}, AD {fmt(commonResult.pooled_fit.AD)}
                    {!commonResult.pooled_fit.fit_eligible
                      && ` — ${commonResult.pooled_fit.eligibility_reasons.join('; ')}`}
                    {' '}<span className="text-[10px] opacity-75">(hover for optimizer diagnostics)</span>
                  </p>
                )}

                <div className="flex items-center gap-1 mb-2 flex-wrap">
                  {(['Contours', 'P-P', 'Q-Q', 'PDF', 'CDF', 'SF', 'HF'] as const).map(view => {
                    const disabled = view === 'Contours' && (contourData.length === 0 || !contourAxes)
                    return (
                      <button key={view} disabled={disabled}
                        onClick={() => setCommonCompareView(view)}
                        className={`px-3 py-1 text-xs rounded border transition-colors ${
                          commonCompareView === view
                            ? 'bg-blue-600 text-white border-blue-600'
                            : disabled
                              ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                              : 'border-gray-300 text-gray-600'
                        }`}>
                        {view}
                      </button>
                    )
                  })}
                </div>
                {commonCompareView === 'Contours' ? (
                  contourData.length > 0 && contourAxes ? (
                    <>
                      <p className="text-xs text-gray-400 mb-2">
                        {Math.round(commonResult.CI * 100)}% joint confidence regions for eligible
                        temporary fits. Overlap is meaningful only under the common-family assumption.
                      </p>
                      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 480 }}>
                        <Plot
                          data={contourData as Plotly.Data[]}
                          layout={{
                            xaxis: { title: { text: contourAxes.x_name }, gridcolor: '#e5e7eb' },
                            yaxis: { title: { text: contourAxes.y_name }, gridcolor: '#e5e7eb' },
                            margin: { t: 20, r: 20, b: 50, l: 60 },
                            paper_bgcolor: 'white', plot_bgcolor: 'white',
                            showlegend: true,
                            legend: { x: 0.02, y: 0.98, font: { size: 11 } },
                          } as PlotlyLayout}
                          config={{ responsive: true }}
                          style={{ width: '100%', height: '100%' }}
                          useResizeHandler
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400">
                      Likelihood contours require eligible two-parameter temporary fits.
                    </p>
                  )
                ) : (() => {
                  const viewData = commonCompareViewData()
                  return (
                    <>
                      <p className="text-xs text-gray-400 mb-2">
                        {commonCompareView === 'P-P' || commonCompareView === 'Q-Q'
                          ? 'Only eligible temporary fits are shown; points near the diagonal indicate better conditional fit.'
                          : `Temporary ${commonCompareView} curves for eligible common-family fits.`}
                      </p>
                      <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 480 }}>
                        <Plot
                          data={viewData.data as Plotly.Data[]}
                          layout={{
                            xaxis: { title: { text: viewData.xLabel }, gridcolor: '#e5e7eb' },
                            yaxis: { title: { text: viewData.yLabel }, gridcolor: '#e5e7eb' },
                            margin: { t: 20, r: 20, b: 50, l: 60 },
                            paper_bgcolor: 'white', plot_bgcolor: 'white',
                            showlegend: true,
                            legend: { x: 0.02, y: 0.98, font: { size: 11 } },
                          } as PlotlyLayout}
                          config={{ responsive: true }}
                          style={{ width: '100%', height: '100%' }}
                          useResizeHandler
                        />
                      </div>
                    </>
                  )
                })()}
              </section>
            )}
          </div>
        </div>
      ) : (
        /* ================= Folio view ================= */
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel */}
          <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-2.5">
            <button
              onClick={() => setWizardOpen(true)}
              title="Answer a few questions and get the appropriate analysis mode"
              className="flex items-center justify-center gap-2 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded py-2 transition-colors"
            >
              <Wand2 size={13} /> Analysis wizard — help me choose
            </button>
            <LifeDataWizard
              open={wizardOpen}
              onClose={() => setWizardOpen(false)}
              onApply={p => { patchActive(p); setWizardOpen(false) }}
            />
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['parametric', 'Parametric'],
                ['nonparametric', 'Non-Param'],
                ['special', 'Special'],
                ['weibayes', 'Weibayes'],
                ['cfm', 'CFM'],
                ['stressstrength', 'S-S'],
              ] as const).map(([mode, label]) => (
                <button key={mode}
                  onClick={() => patchActive({ analysisMode: mode })}
                  className={`py-1 text-xs rounded font-medium border transition-colors ${
                    folio.analysisMode === mode ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                  }`}
                >{label}</button>
              ))}
            </div>

            {/* Data source toggle */}
            <div className="flex items-center gap-2">
              <InfoLabel tip="Choose whether to enter observed life data in a table or specify a known distribution model directly" className="mb-0 flex-shrink-0">Data source</InfoLabel>
              <div className="flex gap-2 flex-1">
                <button onClick={() => patchActive(f => ({
                  dataSource: 'table',
                  specResult: null,
                  setDist: f.dataSource === 'spec' && f.setDist === f.spec.distribution ? null : f.setDist,
                }))}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${
                    folio.dataSource === 'table' ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-300 text-gray-600'
                  }`}>Data table</button>
                <button onClick={() => patchActive({ dataSource: 'spec' })}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${
                    folio.dataSource === 'spec' ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-300 text-gray-600'
                  }`}>Distribution spec</button>
              </div>
            </div>

            {folio.dataSource === 'table'
                && (folio.analysisMode === 'parametric' || folio.analysisMode === 'nonparametric') && (
              <div>
                <InfoLabel tip="Individual rows contain exact observations. Exact-frequency rows store repeated exact times with counts. Inspection intervals store counts whose event times are known only within (lower, upper].">Observation format</InfoLabel>
                <div className="grid grid-cols-3 gap-1">
                  {([
                    ['individual', 'Individual'],
                    ['frequency', 'Frequency'],
                    ['interval', 'Intervals'],
                  ] as const).map(([format, label]) => (
                    <button key={format} onClick={() => {
                      patchActive({ dataFormat: format })
                      if (format === 'interval') setActiveViews(['CDF'])
                    }}
                      className={`py-1 text-[11px] rounded border transition-colors ${
                        (folio.dataFormat ?? 'individual') === format
                          ? 'bg-slate-700 text-white border-slate-700'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {folio.dataSource === 'table' ? (
              (folio.dataFormat ?? 'individual') === 'individual' ? (
                <>
                {/* Data table (import/example live in its header row) */}
                <div onPaste={handlePaste} ref={tableRef}>
                  <div className="flex items-center gap-2 mb-1">
                    <InfoLabel tip="Enter failure (F) and suspension/right-censored (S) times. Paste tabular data directly into the table, or import a CSV file." className="mb-0">Life Data</InfoLabel>
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] border border-dashed border-gray-300 rounded hover:border-blue-400 hover:bg-blue-50 transition-colors text-gray-600"
                    >
                      <Upload size={10} /> Import CSV
                    </button>
                    <input ref={fileRef} type="file" accept=".csv" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleCSV(f); e.target.value = '' }} />
                    <ExampleButton
                      hasData={folio.rows.some(r => r.time.trim() !== '')}
                      onLoad={() => patchActive({
                        rows: EXAMPLE_ROWS.map(r => ({ key: makeKey(), id: '', time: r.time, state: r.state })),
                        dataSource: 'table',
                        dataFormat: 'individual',
                      })}
                      className="flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-700"
                    />
                    <span className="ml-auto text-[10px] text-gray-400">
                      {(() => { const { failures, rc } = folioData(folio); return `${failures.length}F ${rc.length}S` })()}
                    </span>
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="max-h-[25vh] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-500 w-16 select-none cursor-pointer hover:text-blue-600"
                            onClick={() => toggleLdSort('id')}>ID {ldSortCol === 'id' ? <span className="text-[10px]">{ldSortDir === 'asc' ? '▲' : '▼'}</span> : ''}</th>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-500 select-none cursor-pointer hover:text-blue-600"
                            onClick={() => toggleLdSort('time')}>Time ({units}) {ldSortCol === 'time' ? <span className="text-[10px]">{ldSortDir === 'asc' ? '▲' : '▼'}</span> : ''}</th>
                          <th className="px-2 py-1.5 text-center font-medium text-gray-500 w-14 select-none cursor-pointer hover:text-blue-600"
                            onClick={() => toggleLdSort('state')}>State {ldSortCol === 'state' ? <span className="text-[10px]">{ldSortDir === 'asc' ? '▲' : '▼'}</span> : ''}</th>
                          <th className="w-7"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {ldSortedIndices.map(i => (
                          <DataGridRow
                            key={folio.rows[i].key}
                            row={folio.rows[i]}
                            index={i}
                            onUpdate={updateRow}
                            onRemove={removeRow}
                            onTimeKeyDown={handleTimeKeyDown}
                          />
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
                    {(() => {
                      const idSet = new Set(folio.rows.map(r => r.id.trim()).filter(Boolean))
                      return idSet.size >= 2 ? (
                        <button onClick={splitByGroupId}
                          title="Create a separate analysis for each unique ID in this dataset"
                          className="flex items-center gap-1 px-2 py-0.5 text-[10px] border border-gray-300 rounded text-gray-500 hover:text-blue-600 hover:border-blue-400 transition-colors">
                          Split IDs into Analyses ({idSet.size})
                        </button>
                      ) : <span className="text-[10px] text-gray-300">Tab in last Time cell adds a row</span>
                    })()}
                  </div>
                </div>
                </>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <InfoLabel
                      className="mb-0"
                      tip={(folio.dataFormat ?? 'individual') === 'frequency'
                        ? 'Each row represents count repeated observations at one exact failure or suspension time. The likelihood is identical to expanding the row count times.'
                        : 'Each row represents count observations in (lower, upper]. Blank lower means left-censored; blank upper means right-censored. No midpoint substitution is used.'}
                    >
                      {(folio.dataFormat ?? 'individual') === 'frequency'
                        ? 'Exact-time Frequency Data' : 'Inspection-Interval Data'}
                    </InfoLabel>
                    <span className="text-[10px] text-gray-400">
                      {(() => {
                        const counts = folioObservationCounts(folio)
                        return `${counts.failures}F ${counts.censored}S`
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-end mb-1">
                    <button onClick={() => groupedFileRef.current?.click()}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] border border-dashed border-gray-300 rounded hover:border-blue-400 hover:bg-blue-50 text-gray-600">
                      <Upload size={10} /> Import grouped CSV
                    </button>
                    <input ref={groupedFileRef} type="file" accept=".csv" className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleCSV(file)
                        e.target.value = ''
                      }} />
                  </div>
                  {(folio.dataFormat ?? 'individual') === 'frequency' ? (
                    <GroupedDataGrid
                      format="frequency"
                      rows={folio.frequencyRows ?? [newFrequencyRow()]}
                      units={units}
                      newRow={newFrequencyRow}
                      onChange={frequencyRows => patchActive({ frequencyRows })}
                    />
                  ) : (
                    <GroupedDataGrid
                      format="interval"
                      rows={folio.intervalRows ?? [newIntervalRow()]}
                      units={units}
                      newRow={newIntervalRow}
                      onChange={intervalRows => patchActive({ intervalRows })}
                    />
                  )}
                </div>
              )
            ) : (
              /* Distribution spec input */
              <div className="flex flex-col gap-3">
                {/* MC mode toggle */}
                <div>
                  <InfoLabel tip="Single distribution: sample from one distribution. User equation: combine multiple random variables via a formula (e.g. Y = A + B + C).">MC mode</InfoLabel>
                  <div className="flex gap-2">
                    {([['single', 'Single distribution'], ['equation', 'User equation']] as const).map(([m, label]) => (
                      <button key={m}
                        onClick={() => patchActive(f => ({
                          spec: { ...f.spec, mcMode: m },
                          specResult: null,
                          setDist: f.dataSource === 'spec' && f.setDist === f.spec.distribution ? null : f.setDist,
                        }))}
                        className={`flex-1 py-1 text-xs rounded border transition-colors ${
                          folio.spec.mcMode === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                        }`}>{label}</button>
                    ))}
                  </div>
                </div>

                {folio.spec.mcMode === 'single' ? (
                  <>
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
                            specResult: null,
                            setDist: f.dataSource === 'spec' && f.setDist === f.spec.distribution ? null : f.setDist,
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
                          <NumberField
                            value={folio.spec.params[p] ?? ''}
                            semantic={p}
                            onChange={value => patchActive(f => ({
                              spec: { ...f.spec, params: { ...f.spec.params, [p]: value } },
                              specResult: null,
                              setDist: f.dataSource === 'spec' && f.setDist === f.spec.distribution ? null : f.setDist,
                            }))}
                            className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </div>
                      ))}
                    </div>

                  </>
                ) : (
                  <>
                    {/* Equation mode: variable list + equation input */}
                    <div className="flex flex-col gap-2">
                      {folio.spec.mcVariables.map(v => (
                        <div key={v.id} className="border border-gray-200 rounded p-2 bg-gray-50 flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <input type="text" value={v.name}
                              onChange={e => updateVariable(v.id, 'name', e.target.value)}
                              className="w-12 text-xs font-mono font-bold border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              placeholder="A" />
                            <select value={v.distribution}
                              onChange={e => updateVariable(v.id, 'distribution', e.target.value)}
                              className="flex-1 text-[11px] border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                              {ALL_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <button onClick={() => importFromFolio(v.id)} title="Import from fitted analysis"
                              className="p-0.5 text-blue-500 hover:text-blue-700"><Upload size={12} /></button>
                            <button onClick={() => removeVariable(v.id)} title="Remove variable"
                              disabled={folio.spec.mcVariables.length <= 1}
                              className="p-0.5 text-red-400 hover:text-red-600 disabled:opacity-30"><Trash2 size={12} /></button>
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {DIST_PARAM_FIELDS[v.distribution].map(p => (
                              <div key={p} className="flex items-center gap-1">
                                <span className="text-[10px] text-gray-500 w-8 text-right">{p}</span>
                                <NumberField
                                  value={v.params[p] ?? ''}
                                  semantic={p}
                                  onChange={value => updateVariableParam(v.id, p, value)}
                                  className="flex-1 text-[11px] font-mono border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {folio.spec.mcVariables.length < 20 && (
                        <button onClick={addVariable}
                          className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 self-start">
                          <Plus size={11} /> Add variable
                        </button>
                      )}
                    </div>
                    <div>
                      <InfoLabel tip="Equation combining the variables above. Supports: + - * / ** and functions sqrt, exp, log, sin, cos, pow, min, max, abs.">Equation</InfoLabel>
                      <input type="text"
                        value={folio.spec.mcEquation}
                        onChange={e => patchActive(f => ({ spec: { ...f.spec, mcEquation: e.target.value } }))}
                        placeholder="e.g. A + B + C"
                        className="w-full text-xs font-mono border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                  </>
                )}

                <hr className="border-gray-200" />

                <p className="text-xs font-semibold text-gray-800">Monte Carlo simulation</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <InfoLabel tip={`Number of random samples to generate (2 to ${folio.spec.mcMode === 'equation' ? '100,000' : '10,000'})`}>Samples (n)</InfoLabel>
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
                <div>
                  <InfoLabel tip="Optional label written to the ID column of every generated row. Useful for tagging a dataset (e.g. 'Stress' or 'Strength') so it can later be fitted as a group.">
                    Dataset ID <span className="text-gray-400">(optional)</span>
                  </InfoLabel>
                  <input type="text" value={folio.spec.mcId}
                    onChange={e => patchActive(f => ({ spec: { ...f.spec, mcId: e.target.value } }))}
                    placeholder="e.g. Stress"
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div>
                  <InfoLabel tip="When the analysis already has data: Replace overwrites it; Append adds the generated samples to the existing rows.">If data exists</InfoLabel>
                  <div className="flex gap-2">
                    {(['replace', 'append'] as const).map(m => (
                      <button key={m}
                        onClick={() => patchActive(f => ({ spec: { ...f.spec, genMode: m } }))}
                        className={`flex-1 py-1 text-xs rounded border capitalize transition-colors ${
                          folio.spec.genMode === m ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-600'
                        }`}>{m}</button>
                    ))}
                  </div>
                </div>
                <button onClick={generateMonteCarlo} disabled={loading}
                  className="flex items-center justify-center gap-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 text-xs font-medium py-1.5 rounded transition-colors">
                  <Dices size={12} /> {folio.spec.genMode === 'append' ? 'Generate & append to table' : 'Generate data into table'}
                </button>
                {folio.spec.mcMode === 'equation' && folio.spec.mcConvergence && (
                  <ConvergencePlot data={folio.spec.mcConvergence} label="Mean of Y" height={200} />
                )}
              </div>
            )}

            {folio.analysisMode === 'parametric' ? (
              <>
                {/* Method + confidence level share one row to keep the pane short */}
                <div className="flex gap-3">
                  <div className="flex-[3]">
                    <InfoLabel tip="MLE: Maximum Likelihood Estimation (recommended for censored data). RRX/RRY: Rank Regression on X or Y axis (least-squares fit to probability plot)">Method</InfoLabel>
                    <div className="flex gap-1">
                      {(['MLE', 'RRX', 'RRY'] as const).map(m => (
                        <button key={m}
                          disabled={(folio.dataFormat ?? 'individual') !== 'individual' && m !== 'MLE'}
                          title={(folio.dataFormat ?? 'individual') !== 'individual' && m !== 'MLE'
                            ? 'Grouped likelihoods use MLE; rank regression has not been validated for weighted or interval-censored observations.'
                            : undefined}
                          onClick={() => patchActive({ method: m })}
                          className={`flex-1 py-1 text-xs rounded border transition-colors ${
                            ((folio.dataFormat ?? 'individual') !== 'individual' ? m === 'MLE' : folio.method === m)
                              ? 'bg-blue-600 text-white border-blue-600'
                              : (folio.dataFormat ?? 'individual') !== 'individual'
                                ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                : 'border-gray-300 text-gray-600'
                          }`}>{m}</button>
                      ))}
                    </div>
                    {(folio.dataFormat ?? 'individual') !== 'individual' && (
                      <p className="text-[10px] text-gray-400 mt-1">Grouped formats use weighted maximum likelihood.</p>
                    )}
                  </div>
                  <div className="flex-[2]">
                    <InfoLabel tip="Confidence level for parameter confidence intervals and bounds on the probability plot (e.g. 0.95 = 95%). Type any value in (0, 1).">Conf. level</InfoLabel>
                    <ConfidenceInput
                      value={folio.ciText}
                      onChange={value => patchActive({ ciText: value })}
                      onCommit={ci => patchActive({ ci })}
                      className="w-full"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <InfoLabel tip="Select which parametric distributions to fit. The best fit is chosen by AICc." className="mb-0">Distributions</InfoLabel>
                    <div className="flex gap-1">
                      <button onClick={() => patchActive({
                        selectedDists: (folio.dataFormat ?? 'individual') === 'interval'
                          ? INTERVAL_DISTS : ALL_DISTS,
                      })}
                        className="text-xs text-blue-600 hover:underline">All</button>
                      <span className="text-gray-300">|</span>
                      <button onClick={() => patchActive({ selectedDists: [] })}
                        className="text-xs text-gray-500 hover:underline">None</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {ALL_DISTS.map(d => {
                      const unavailable = (folio.dataFormat ?? 'individual') === 'interval'
                        && !INTERVAL_DISTS.includes(d)
                      return (
                      <label key={d}
                        title={unavailable
                          ? 'Unavailable for interval data: grouped intervals weakly identify this distribution threshold/location parameter.'
                          : undefined}
                        className={`flex items-center gap-1.5 text-[11px] ${
                          unavailable ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 cursor-pointer'}`}>
                        <input type="checkbox" disabled={unavailable}
                          checked={!unavailable && folio.selectedDists.includes(d)}
                          onChange={() => patchActive(f => ({
                            selectedDists: f.selectedDists.includes(d)
                              ? f.selectedDists.filter(x => x !== d)
                              : [...f.selectedDists, d],
                          }))}
                          className="rounded text-blue-600" />
                        {d}
                      </label>
                    )})}
                  </div>
                  {(folio.dataFormat ?? 'individual') === 'interval' && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      Threshold/location variants are disabled because inspection intervals do not identify the threshold reliably. Beta requires bounds within [0, 1].
                    </p>
                  )}
                </div>

              </>
            ) : folio.analysisMode === 'nonparametric' ? (
              <div>
                <InfoLabel tip={(folio.dataFormat ?? 'individual') === 'interval'
                  ? 'Turnbull is the nonparametric maximum-likelihood estimator for interval-censored observations.'
                  : 'Kaplan-Meier estimates the survival function. Nelson-Aalen estimates the cumulative hazard function.'}>Estimator</InfoLabel>
                {(folio.dataFormat ?? 'individual') === 'interval' ? (
                  <div className="text-xs rounded border border-blue-200 bg-blue-50 text-blue-800 p-2">
                    Turnbull EM NPMLE
                  </div>
                ) : (folio.dataFormat ?? 'individual') === 'frequency' ? (
                  <div className="text-xs rounded border border-amber-200 bg-amber-50 text-amber-800 p-2">
                    Exact-frequency nonparametric estimation is not yet available. Use Parametric MLE or individual observations.
                  </div>
                ) : <div className="flex gap-2">
                  {(['KM', 'NA'] as const).map(m => (
                    <button key={m} onClick={() => patchActive({ npMethod: m })}
                      className={`flex-1 py-1 text-xs rounded border transition-colors ${
                        folio.npMethod === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                      }`}>
                      {m === 'KM' ? 'Kaplan-Meier' : 'Nelson-Aalen'}
                    </button>
                  ))}
                </div>}
              </div>
            ) : folio.analysisMode === 'special' ? (
              <>
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
                {folio.specialModel === 'mixture' && (
                  <div>
                    <InfoLabel tip="Number of Weibull sub-populations to fit. Each sub-population has its own shape (β), scale (η), and proportion. More sub-populations require more failure data to converge.">Sub-populations</InfoLabel>
                    <div className="flex gap-1">
                      {([2, 3, 4] as const).map(n => (
                        <button key={n} onClick={() => patchActive({ mixtureSubs: n })}
                          className={`flex-1 py-1 text-xs rounded border transition-colors ${
                            (folio.mixtureSubs ?? 2) === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                          }`}>{n}</button>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                      R(t) = Σ ρᵢ · exp(−(t/ηᵢ)^βᵢ), where Σρᵢ = 1
                    </p>
                  </div>
                )}
              </>
            ) : folio.analysisMode === 'weibayes' ? (
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
                  <InfoLabel tip="Fixed β gives the conventional conditional interval. Sensitivity envelopes a plausible β range. Bayesian propagation combines a truncated-normal β prior with the Weibull likelihood.">Shape uncertainty</InfoLabel>
                  <select value={folio.weibayesUncertaintyMethod ?? 'fixed'}
                    onChange={e => patchActive({ weibayesUncertaintyMethod: e.target.value as Folio['weibayesUncertaintyMethod'] })}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white">
                    <option value="fixed">Fixed β (conditional)</option>
                    <option value="sensitivity">β range sensitivity</option>
                    <option value="bayesian">Bayesian β propagation</option>
                  </select>
                  {(folio.weibayesUncertaintyMethod ?? 'fixed') === 'sensitivity' && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <label className="text-[10px] text-gray-500">β lower
                        <NumberField value={folio.weibayesBetaLower ?? ''}
                          onChange={v => patchActive({ weibayesBetaLower: v })}
                          step={0.1} min={0.0001} className="w-full mt-0.5" />
                      </label>
                      <label className="text-[10px] text-gray-500">β upper
                        <NumberField value={folio.weibayesBetaUpper ?? ''}
                          onChange={v => patchActive({ weibayesBetaUpper: v })}
                          step={0.1} min={0.0001} className="w-full mt-0.5" />
                      </label>
                    </div>
                  )}
                  {(folio.weibayesUncertaintyMethod ?? 'fixed') === 'bayesian' && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <label className="text-[10px] text-gray-500">Prior β SD
                        <NumberField value={folio.weibayesBetaSd ?? ''}
                          onChange={v => patchActive({ weibayesBetaSd: v })}
                          step={0.05} min={0.0001} className="w-full mt-0.5" />
                      </label>
                      <label className="text-[10px] text-gray-500">Samples
                        <NumberField value={folio.weibayesSamples ?? '4000'}
                          onChange={v => patchActive({ weibayesSamples: v })}
                          step={500} min={500} className="w-full mt-0.5" />
                      </label>
                    </div>
                  )}
                </div>
                <div>
                  <InfoLabel tip="Confidence level for the bounds on the characteristic life η (e.g. 0.95 = 95%)">Confidence level</InfoLabel>
                  <ConfidenceInput value={folio.ciText}
                    onChange={value => patchActive({ ciText: value })}
                    onCommit={ci => patchActive({ ci })} className="w-full" />
                </div>
              </>
            ) : folio.analysisMode === 'cfm' ? (
              <>
                <div>
                  <InfoLabel tip="Competing Failure Modes: each distinct ID in the data table is treated as a separate failure mode. For each mode, that mode's failures are analyzed while all other modes' failures become suspensions. The system reliability is the product of per-mode reliabilities.">Failure Mode Groups</InfoLabel>
                  {(() => {
                    const modeMap: Record<string, number> = {}
                    for (const r of folio.rows) {
                      const t = parseFloat(r.time)
                      if (isNaN(t) || t <= 0 || r.state !== 'F') continue
                      const m = r.id.trim() || '__unassigned__'
                      modeMap[m] = (modeMap[m] || 0) + 1
                    }
                    const modes = Object.entries(modeMap).sort((a, b) => b[1] - a[1])
                    return modes.length >= 2 ? (
                      <div className="space-y-1 mt-1">
                        {modes.map(([m, n]) => (
                          <div key={m} className="flex items-center justify-between text-xs">
                            <span className="text-gray-600 truncate">{m === '__unassigned__' ? '(no ID)' : m}</span>
                            <span className="text-gray-400 font-mono ml-2">{n}F</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-amber-600 mt-1">
                        Assign failure mode IDs in the ID column. At least 2 distinct modes are required.
                      </p>
                    )
                  })()}
                </div>
                <div>
                  <InfoLabel tip="Distribution to fit for each failure mode.">Distribution</InfoLabel>
                  <select
                    value={folio.cfmDist ?? 'Weibull_2P'}
                    onChange={e => patchActive({ cfmDist: e.target.value })}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {ALL_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <InfoLabel tip="Method for fitting each mode's distribution.">Method</InfoLabel>
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
                  <InfoLabel tip="Confidence level for parameter confidence intervals.">Confidence level</InfoLabel>
                  <ConfidenceInput value={folio.ciText}
                    onChange={value => patchActive({ ciText: value })}
                    onCommit={ci => patchActive({ ci })} className="w-full" />
                </div>
                <div>
                  <InfoLabel tip="Compute system and per-mode reliability at a specific time. Leave blank to skip.">R(t) query time</InfoLabel>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={folio.cfmReliabilityTime ?? ''}
                    onChange={e => patchActive({ cfmReliabilityTime: e.target.value })}
                    placeholder="e.g. 1000"
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </>
            ) : folio.analysisMode === 'stressstrength' ? (() => {
              const ssSource = folio.ssSource ?? 'params'
              const groupIds = [...new Set(folio.rows.map(r => r.id.trim()).filter(Boolean))]
              return (
              <>
                {/* Parameter source toggle: typed-in vs fit from data-table ID groups */}
                <div>
                  <InfoLabel tip="Choose whether to type distribution parameters directly, or to fit them from groups of life data identified by the ID column (e.g. one ID for the stress data, another for the strength data).">Parameter source</InfoLabel>
                  <div className="flex gap-2">
                    <button onClick={() => patchActive({ ssSource: 'params' })}
                      className={`flex-1 py-1 text-xs rounded border transition-colors ${
                        ssSource === 'params' ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-300 text-gray-600'
                      }`}>Parameters</button>
                    <button onClick={() => patchActive({ ssSource: 'data' })}
                      className={`flex-1 py-1 text-xs rounded border transition-colors ${
                        ssSource === 'data' ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-300 text-gray-600'
                      }`}>From data (by ID)</button>
                  </div>
                </div>

                {ssSource === 'data' && groupIds.length < 2 && (
                  <p className="text-[10px] text-amber-600">Label rows in the data table's ID column with at least two distinct groups (e.g. one for stress, one for strength) to fit by group.</p>
                )}

                <div>
                  <InfoLabel tip="Distribution representing the applied stress or load" className="text-[10px] text-gray-500 mb-0.5">Stress distribution</InfoLabel>
                  <select value={folio.ssStressDist ?? 'Normal_2P'} onChange={e => {
                    const fields = DIST_PARAM_FIELDS[e.target.value] ?? []
                    patchActive({ ssStressDist: e.target.value, ssStressParams: Object.fromEntries(fields.map(f => [f, PARAM_DEFAULTS[f] ?? '1'])) })
                  }}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                    {ALL_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  {ssSource === 'data' ? (
                    <select value={folio.ssStressGroup ?? ''} onChange={e => patchActive({ ssStressGroup: e.target.value })}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1 mt-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                      <option value="">Stress ID group…</option>
                      {groupIds.map(id => <option key={id} value={id}>{id}</option>)}
                    </select>
                  ) : (
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      {(DIST_PARAM_FIELDS[folio.ssStressDist ?? 'Normal_2P'] ?? []).map(p => (
                        <input key={p} type="text" placeholder={p}
                          value={(folio.ssStressParams ?? {})[p] ?? PARAM_DEFAULTS[p] ?? ''}
                          onChange={e => patchActive(f => ({ ssStressParams: { ...(f.ssStressParams ?? {}), [p]: e.target.value } }))}
                          className="text-xs border border-gray-300 rounded px-1.5 py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                          title={p} />
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <InfoLabel tip="Distribution representing the material or component strength capacity" className="text-[10px] text-gray-500 mb-0.5">Strength distribution</InfoLabel>
                  <select value={folio.ssStrengthDist ?? 'Normal_2P'} onChange={e => {
                    const fields = DIST_PARAM_FIELDS[e.target.value] ?? []
                    patchActive({ ssStrengthDist: e.target.value, ssStrengthParams: Object.fromEntries(fields.map(f => [f, PARAM_DEFAULTS[f] ?? '1'])) })
                  }}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                    {ALL_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  {ssSource === 'data' ? (
                    <select value={folio.ssStrengthGroup ?? ''} onChange={e => patchActive({ ssStrengthGroup: e.target.value })}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1 mt-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                      <option value="">Strength ID group…</option>
                      {groupIds.map(id => <option key={id} value={id}>{id}</option>)}
                    </select>
                  ) : (
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      {(DIST_PARAM_FIELDS[folio.ssStrengthDist ?? 'Normal_2P'] ?? []).map(p => (
                        <input key={p} type="text" placeholder={p}
                          value={(folio.ssStrengthParams ?? {})[p] ?? PARAM_DEFAULTS[p] ?? ''}
                          onChange={e => patchActive(f => ({ ssStrengthParams: { ...(f.ssStrengthParams ?? {}), [p]: e.target.value } }))}
                          className="text-xs border border-gray-300 rounded px-1.5 py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                          title={p} />
                      ))}
                    </div>
                  )}
                </div>
              </>
              )
            })() : null}

            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

            <button
              onClick={folio.analysisMode === 'parametric' && folio.dataSource === 'spec' && folio.spec.mcMode === 'single'
                ? showSpecModel
                : folio.analysisMode === 'special' ? runSpecial
                : folio.analysisMode === 'weibayes' ? runWeibayes
                : folio.analysisMode === 'cfm' ? runCFM
                : folio.analysisMode === 'stressstrength' ? runStressStrength
                : run}
              disabled={loading || (folio.analysisMode === 'parametric' && folio.dataSource === 'spec' && folio.spec.mcMode === 'equation')}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {loading ? 'Running...'
                : folio.analysisMode === 'parametric' && folio.dataSource === 'spec' && folio.spec.mcMode === 'single' ? 'Show model (no data)'
                : folio.analysisMode === 'parametric' && folio.dataSource === 'spec' ? 'Generate data first'
                : folio.analysisMode === 'special' ? 'Fit Special Model'
                : folio.analysisMode === 'weibayes' ? 'Fit Weibayes'
                : folio.analysisMode === 'cfm' ? 'Run CFM Analysis'
                : folio.analysisMode === 'stressstrength' ? 'Compute Interference'
                : 'Run Analysis'}
            </button>
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <StaleBanner show={isStale}
              onRerun={folio.analysisMode === 'special' ? runSpecial
                : folio.analysisMode === 'weibayes' ? runWeibayes
                : folio.analysisMode === 'cfm' ? runCFM : run}
              rerunLabel="Re-run analysis" />
            {showFitProgress && fitProgress && (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-96 max-w-[80%] text-center">
                  <Loader2 size={28} className="animate-spin mx-auto mb-4 text-blue-600" />
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full transition-all"
                      style={{ width: `${Math.round(100 * fitProgress.done / fitProgress.total)}%` }} />
                  </div>
                  <p className="text-sm text-gray-600 mt-3">
                    Fitting distributions… {fitProgress.done}/{fitProgress.total}
                  </p>
                  {fitProgress.current && (
                    <p className="text-xs text-gray-400 mt-0.5">{fitProgress.current}</p>
                  )}
                </div>
              </div>
            )}
            {!showFitProgress && currentModeHasResult && (
              <div ref={resultsRef} className="flex-1 overflow-hidden flex flex-col">
                <div className="flex justify-end">
                  <ExportResultsButton getElement={() => resultsRef.current} baseName="life_data" />
                </div>
            {/* Spec model (no data) — curves only */}
            {folio.analysisMode === 'parametric' && folio.specResult && !fitResult && (
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
                <div className="mb-4 rounded-lg border border-green-200 bg-green-50/50 p-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-xs font-medium text-green-800 flex items-center gap-1.5">
                      <Check size={12} /> Active specified distribution
                    </p>
                    <span className="text-[10px] text-green-700">Available to linked Perdura modules</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <NumberField value={calcTime} onChange={setCalcTime} semantic="Mission end time"
                      placeholder="Mission end" title="Mission end time" className="bg-white" />
                    <NumberField value={calcElapsed} onChange={setCalcElapsed} semantic="Elapsed time"
                      placeholder="Elapsed (optional)" title="Elapsed survival time" className="bg-white" />
                    <NumberField value={calcRel} onChange={setCalcRel} min={0} max={1} step={0.01}
                      placeholder="Reliability target" title="Reliability target" className="bg-white" />
                    <NumberField value={calcBx} onChange={setCalcBx} min={0} max={100} step={1}
                      placeholder="BX % failed" title="BX percent failed" className="bg-white" />
                  </div>
                  <button onClick={runCalc} disabled={calcLoading}
                    className="mt-2 px-3 py-1 text-xs bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50">
                    <span className="inline-flex items-center gap-1"><Calculator size={11} /> {calcLoading ? 'Calculating…' : 'Calculate model metrics'}</span>
                  </button>
                  {calcResult && (
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-1 text-xs font-mono">
                      {calcResult.reliability != null && <CalcRow label="R(t)" value={fmt(calcResult.reliability)} />}
                      {calcResult.prob_failure != null && <CalcRow label="F(t)" value={fmt(calcResult.prob_failure)} />}
                      {calcResult.conditional_reliability != null && <CalcRow label="Conditional R" value={fmt(calcResult.conditional_reliability)} />}
                      {calcResult.failure_rate != null && <CalcRow label="h(t)" value={fmt(calcResult.failure_rate)} />}
                      {calcResult.reliable_life != null && <CalcRow label="Reliable life" value={fmtNum(calcResult.reliable_life)} />}
                      {calcResult.bx_life != null && <CalcRow label={`B${calcResult.bx_percent ?? ''} life`} value={fmtNum(calcResult.bx_life)} />}
                      {calcResult.mean_life != null && <CalcRow label="Mean life" value={fmtNum(calcResult.mean_life)} />}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 mb-2">
                  {CURVE_TABS.map(t => (
                    <button key={t} onClick={() => setActiveViews([t])}
                      className={`px-3 py-1 text-xs rounded border transition-colors ${
                        curveTab === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                      }`}>{t}</button>
                  ))}
                </div>
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 420 }}>
                  <Plot
                    data={curvePlotData as Plotly.Data[]}
                    layout={{ ...curveLayout, title: { text: plotTitle('spec', `${folio.specResult.distribution} (specified) — ${curveTab}`), font: { size: 13 } } } as any}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              </div>
            )}

            {folio.analysisMode === 'parametric' && fitResult && (
              <>
                <div className="flex-1 overflow-hidden flex">
                  {/* Results table */}
                  <div className="w-80 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-3">
                    {fitResult.observation_model && fitResult.observation_model !== 'individual' && (
                      <div className="mb-2 rounded border border-blue-200 bg-blue-50 p-2 text-[10px] text-blue-800 leading-snug">
                        <p className="font-semibold">
                          {fitResult.observation_model === 'frequency_exact'
                            ? 'Exact-time frequency likelihood'
                            : 'Interval-censored likelihood'}
                        </p>
                        <p>
                          MLE with effective sample size F={fitResult.n_failures ?? 0},
                          {' '}S={fitResult.n_censored ?? 0}.
                          {fitResult.observation_model === 'interval_censored'
                            && ' AD, exact-time probability, Q-Q, and P-P diagnostics are intentionally unavailable.'}
                        </p>
                      </div>
                    )}
                    <button
                      onClick={() => patchActive({ fitTableCollapsed: !folio.fitTableCollapsed })}
                      className="w-full flex items-start gap-1.5 text-left text-xs font-medium text-gray-500 mb-2 rounded hover:bg-gray-50 px-1 py-1"
                      title={folio.fitTableCollapsed ? 'Expand fit results' : 'Collapse fit results'}
                    >
                      {folio.fitTableCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      <span className="min-w-0">
                        Fit Results — best: <span className="text-green-700 font-semibold">
                          {fitResult.best_distribution ?? 'No eligible AICc model'}
                        </span>
                        {folio.fitTableCollapsed && folio.setDist && (
                          <span className="block text-[10px] text-green-600 mt-0.5">Set: {folio.setDist}</span>
                        )}
                      </span>
                    </button>
                    {!folio.fitTableCollapsed && (
                      <>
                        <ResultsTable
                          columns={tableColumns}
                          rows={fitResult.results as unknown as Record<string, unknown>[]}
                          rowKey="Distribution"
                          selectedRow={activeDist}
                          highlightFirst={false}
                          onRowClick={row => patchActive({ selectedDist: row.Distribution as string })}
                          rowClassName={row => {
                            if (row.Distribution === folio.setDist) return 'bg-green-50 ring-1 ring-inset ring-green-300'
                            if (row.fit_eligible === false) return 'bg-red-50/70'
                            return ''
                          }}
                          rowTitle={row => row.fit_eligible === false
                            ? `Ineligible fit: ${((row.eligibility_reasons as string[] | undefined) ?? []).join('; ') || 'fit diagnostics did not satisfy eligibility requirements'}`
                            : undefined}
                          sortable
                        />
                        <p className="mt-1 text-[10px] text-gray-500">
                          <span className="inline-block w-2 h-2 rounded-sm bg-red-100 border border-red-200 mr-1" />
                          Red rows are ineligible and are excluded from comparison plots.
                        </p>
                      </>
                    )}
                    {folio.setDist && !folio.fitTableCollapsed && (
                      <p className="text-[10px] text-green-600 mt-1 flex items-center gap-1">
                        <Check size={10} /> Set: {folio.setDist}
                      </p>
                    )}
                    {!folio.fitTableCollapsed && activeDist && (
                      <button
                        onClick={() => patchActive({ setDist: activeDist, fitTableCollapsed: true })}
                        disabled={folio.setDist === activeDist || !activeFitRow?.fit_eligible}
                        title={!activeFitRow?.fit_eligible ? 'Ineligible fits cannot be set as the active distribution' : undefined}
                        className={`mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded border transition-colors ${
                          folio.setDist === activeDist
                            ? 'bg-green-50 text-green-700 border-green-300 cursor-default'
                            : !activeFitRow?.fit_eligible
                              ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
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

                    {(folio.dataFormat ?? 'individual') === 'individual'
                        && fitResult.results.find(r => r.Distribution === parametricDist)?.fit_eligible && (
                      <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/40 p-2 space-y-2">
                        <InfoLabel
                          className="!text-blue-800 !font-semibold !mb-0"
                          tip="A confidence interval for one derived value from the fitted distribution—not a simultaneous parameter or curve band. Choose reliability at a specified time or a life quantile such as B10. Profile likelihood re-optimizes nuisance parameters; parametric bootstrap simulates and refits datasets to calibrate sampling uncertainty."
                        >
                          Calibrated scalar interval
                        </InfoLabel>
                        <div className="grid grid-cols-2 gap-1">
                          <select value={uncertaintyMethod}
                            onChange={e => setUncertaintyMethod(e.target.value as typeof uncertaintyMethod)}
                            className="text-[11px] border border-gray-300 rounded px-1 py-1 bg-white">
                            <option value="profile_likelihood">Profile likelihood</option>
                            <option value="parametric_bootstrap">Parametric bootstrap</option>
                          </select>
                          <select value={uncertaintyTarget}
                            onChange={e => {
                              const target = e.target.value as typeof uncertaintyTarget
                              setUncertaintyTarget(target)
                              setUncertaintyValue(target === 'quantile' ? '0.1' : '100')
                            }}
                            className="text-[11px] border border-gray-300 rounded px-1 py-1 bg-white">
                            <option value="reliability">Reliability at time</option>
                            <option value="quantile">Life quantile</option>
                          </select>
                        </div>
                        <div className="flex gap-1 items-center">
                          <NumberField value={uncertaintyValue}
                            onChange={setUncertaintyValue}
                            semantic={uncertaintyTarget === 'quantile' ? 'probability quantile' : 'time'}
                            className="w-full text-[11px] border border-gray-300 rounded px-2 py-1 font-mono" />
                          {uncertaintyMethod === 'parametric_bootstrap' && (
                            <NumberField value={uncertaintyBootstrapN}
                              onChange={setUncertaintyBootstrapN} min={20} max={2000} step={20}
                              title="Bootstrap replicates"
                              className="w-16 text-[11px] border border-gray-300 rounded px-1 py-1 font-mono" />
                          )}
                        </div>
                        {uncertaintyMethod === 'parametric_bootstrap' && (
                          <div className="rounded border border-blue-100 bg-white p-1.5 space-y-1">
                            <InfoLabel className="!text-[10px] !mb-0"
                              tip="A bootstrap should reproduce the study's planned censoring mechanism even when every observed unit happened to fail before its censor time. Resampling times seen only among censored units is an explicitly approximate fallback.">
                              Censoring design / sampling plan
                            </InfoLabel>
                            <select value={uncertaintyCensoringMode}
                              onChange={e => setUncertaintyCensoringMode(e.target.value as typeof uncertaintyCensoringMode)}
                              className="w-full text-[10px] border border-gray-300 rounded px-1 py-1 bg-white">
                              <option value="approximate">
                                {hasCalibratedCensoring
                                  ? 'Observed censor times — approximate'
                                  : 'No declared censoring plan — complete sample'}
                              </option>
                              <option value="fixed_administrative">Fixed administrative cutoff</option>
                              <option value="observed_schedule">Planned per-unit schedule</option>
                              <option value="parametric_independent">Independent parametric censoring</option>
                            </select>
                            {(uncertaintyCensoringMode === 'fixed_administrative'
                                || uncertaintyCensoringMode === 'observed_schedule') && (
                              <input value={uncertaintyCensoringValue}
                                onChange={e => setUncertaintyCensoringValue(e.target.value)}
                                placeholder={uncertaintyCensoringMode === 'fixed_administrative'
                                  ? 'Cutoff time' : `Comma-separated ${calibratedData.failures.length + calibratedData.rc.length}-unit schedule`}
                                className="w-full text-[10px] border border-gray-300 rounded px-1.5 py-1 font-mono" />
                            )}
                            {uncertaintyCensoringMode === 'parametric_independent' && (
                              <div className="grid grid-cols-[6rem_1fr] gap-1">
                                <select value={uncertaintyCensoringDistribution}
                                  onChange={e => setUncertaintyCensoringDistribution(e.target.value as typeof uncertaintyCensoringDistribution)}
                                  className="text-[10px] border border-gray-300 rounded px-1 py-1 bg-white">
                                  <option value="weibull">Weibull</option>
                                  <option value="exponential">Exponential</option>
                                  <option value="lognormal">Lognormal</option>
                                  <option value="uniform">Uniform</option>
                                </select>
                                <input value={uncertaintyCensoringParameters}
                                  onChange={e => setUncertaintyCensoringParameters(e.target.value)}
                                  title="JSON parameters: Weibull shape/scale; exponential scale; lognormal mu/sigma; uniform low/high"
                                  className="min-w-0 text-[10px] border border-gray-300 rounded px-1.5 py-1 font-mono" />
                              </div>
                            )}
                          </div>
                        )}
                        <button onClick={runCalibratedUncertainty} disabled={uncertaintyLoading}
                          className="w-full rounded bg-blue-600 text-white text-[11px] py-1 disabled:opacity-50">
                          {uncertaintyLoading ? 'Calculating…' : 'Calculate interval'}
                        </button>
                        {uncertaintyLoading && uncertaintyMethod === 'parametric_bootstrap' && uncertaintyProgress && (
                          <div className="space-y-1" role="progressbar" aria-label="Bootstrap refit progress"
                            aria-valuemin={0} aria-valuemax={uncertaintyProgress.total}
                            aria-valuenow={uncertaintyProgress.done}>
                            <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
                              <div className="h-full rounded-full bg-blue-600 transition-[width]"
                                style={{ width: `${Math.min(100, 100 * uncertaintyProgress.done / Math.max(1, uncertaintyProgress.total))}%` }} />
                            </div>
                            <p className="text-center text-[10px] text-blue-700">
                              Bootstrap iterations completed {uncertaintyProgress.done}/{uncertaintyProgress.total}
                            </p>
                          </div>
                        )}
                        {uncertaintyError && <p className="text-[10px] text-red-600">{uncertaintyError}</p>}
                        {uncertaintyResult && (
                          <div className="text-[11px] text-gray-700 border-t border-blue-100 pt-1">
                            <p>
                              Estimate <span className="font-mono font-semibold">{fmt(uncertaintyResult.interval.estimate)}</span>
                            </p>
                            <p>
                              {Math.round(uncertaintyResult.interval.CI * 100)}% interval:{' '}
                              <span className="font-mono font-semibold">
                                [{fmt(uncertaintyResult.interval.lower)}, {fmt(uncertaintyResult.interval.upper)}]
                              </span>
                            </p>
                            {uncertaintyResult.interval.n_successful != null && (
                              <p className="text-gray-500">
                                {uncertaintyResult.interval.n_successful}/{uncertaintyResult.interval.n_requested} refits eligible
                              </p>
                            )}
                            {uncertaintyResult.interval.complete === false && (
                              <p className="font-medium text-red-700">
                                {uncertaintyResult.interval.interval_status === 'partial_diagnostic'
                                  ? 'Partial bootstrap diagnostic — too few requested replications or too much refit attrition for a complete interval.'
                                  : 'Incomplete profile interval — one or both verified likelihood-ratio endpoints were unavailable.'}
                              </p>
                            )}
                            {uncertaintyResult.interval.inferential_calibration_status && (
                              <p className={/unverified|unsupported|incomplete|boundary/.test(
                                uncertaintyResult.interval.inferential_calibration_status)
                                ? 'text-red-700' : /asymptotic/.test(
                                  uncertaintyResult.interval.inferential_calibration_status)
                                  ? 'text-amber-700' : 'text-green-700'}>
                                Inferential method: {uncertaintyResult.interval.inferential_calibration_status.replace(/_/g, ' ')}
                              </p>
                            )}
                            {uncertaintyResult.interval.censoring_design_status
                                && uncertaintyResult.interval.censoring_design_status !== 'not_applicable' && (
                              <p className={/approximate|unverified/.test(
                                uncertaintyResult.interval.censoring_design_status)
                                ? 'text-amber-700' : uncertaintyResult.interval.censoring_design_status === 'model_based'
                                  ? 'text-blue-700' : 'text-green-700'}>
                                Censoring design: {uncertaintyResult.interval.censoring_design_status.replace(/_/g, ' ')}
                              </p>
                            )}
                            {!!uncertaintyResult.interval.boundary_parameters?.length && (
                              <p className="text-red-700">
                                Boundary parameter(s): {uncertaintyResult.interval.boundary_parameters.join(', ')}
                              </p>
                            )}
                            {(uncertaintyResult.interval.optimizer_failure_count ?? 0) > 0 && (
                              <p className="text-amber-700">
                                {uncertaintyResult.interval.optimizer_failure_count} profile evaluation(s) failed; only verified endpoints are reported.
                              </p>
                            )}
                            {!!uncertaintyResult.interval.uncertainty_warnings?.length && (
                              <ul className="mt-1 list-disc pl-4 text-amber-700">
                                {uncertaintyResult.interval.uncertainty_warnings.map(warning => (
                                  <li key={warning}>{warning.replace(/_/g, ' ')}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {selectedParams && selectedParams.rows.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-medium text-gray-500 mb-2">
                          Parameters — <span className="font-semibold text-gray-700">{selectedParams.dist}</span>
                          <span className="text-gray-400"> ({ciPct}% CI · {
                            fitResult.results.find(r => r.Distribution === parametricDist)?.parameter_ci_method
                              ?.replace(/_/g, ' ') ?? 'Wald approximation'
                          })</span>
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

                  {/* Plot area — shared with Weibayes (see renderPlotPanel) */}
                  {renderPlotPanel()}
                </div>
              </>
            )}

            {/* Weibull Mixture results — presented like Parametric: probability
                plot + PDF/CDF/SF/HF tabs, ctrl-click multi-select, quad view. */}
            {folio.analysisMode === 'special' && isMixtureMode && specialResult && (
              <div className="flex-1 overflow-hidden flex">
                {/* Summary + parameters sidebar */}
                <div className="w-80 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-3">
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    Weibull Mixture — <span className="text-green-700 font-semibold">
                      {specialResult.sub_curves?.length ?? 2} sub-populations
                    </span>
                  </p>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="rounded-lg border bg-white border-gray-200 p-2">
                      <p className="text-[10px] text-gray-500">Log-Lik</p>
                      <p className="text-sm font-semibold text-gray-900">{fmt(specialResult.loglik)}</p>
                    </div>
                    <div className="rounded-lg border bg-white border-gray-200 p-2">
                      <p className="text-[10px] text-gray-500">AICc</p>
                      <p className="text-sm font-semibold text-gray-900">{fmt(specialResult.AICc)}</p>
                    </div>
                    <div className="rounded-lg border bg-white border-gray-200 p-2">
                      <p className="text-[10px] text-gray-500">BIC</p>
                      <p className="text-sm font-semibold text-gray-900">{fmt(specialResult.BIC)}</p>
                    </div>
                  </div>
                  {!specialResult.fit_eligible && (
                    <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
                      <p className="font-semibold">Fit is not eligible for model selection.</p>
                      <p>{specialResult.eligibility_reasons.join(', ') || 'Diagnostics require review.'}</p>
                      {typeof specialResult.identifiability_diagnostics?.recommendation === 'string' && (
                        <p className="mt-1">{specialResult.identifiability_diagnostics.recommendation}</p>
                      )}
                    </div>
                  )}
                  {specialResult.sub_curves && specialResult.sub_curves.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-gray-500 mb-2">Sub-populations</p>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-200">
                            <th className="text-left py-1 font-medium">#</th>
                            <th className="text-right py-1 font-medium">β</th>
                            <th className="text-right py-1 font-medium">η</th>
                            <th className="text-right py-1 font-medium">ρ</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          {specialResult.sub_curves.map((sc, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="py-1 text-gray-700">
                                <span className="inline-block w-2 h-2 rounded-full mr-1"
                                  style={{ backgroundColor: SUB_COLORS[i % SUB_COLORS.length] }} />
                                {i + 1}
                              </td>
                              <td className="py-1 text-right">{fmt(sc.beta)}</td>
                              <td className="py-1 text-right">{fmt(sc.eta)}</td>
                              <td className="py-1 text-right">{(sc.proportion * 100).toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {/* Full parameter list */}
                  {specialParams.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">Parameters</p>
                      <table className="w-full text-xs border-collapse">
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
                </div>

                {/* Shared plot panel (same as Parametric / Weibayes) */}
                {renderPlotPanel()}
              </div>
            )}

            {/* Special model results (non-mixture: competing risks, DSZI, DS,
                and ZI) — static curve grid. */}
            {folio.analysisMode === 'special' && !isMixtureMode && specialResult && (
              <div className="flex-1 overflow-y-auto p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  {SPECIAL_MODELS.find(m => m.value === specialResult.model)?.label ?? specialResult.model}
                  {specialResult.sub_curves && ` (${specialResult.sub_curves.length} sub-populations)`}
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
                {!specialResult.fit_eligible && (
                  <div className="mb-4 max-w-xl rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                    <p className="font-semibold">Fit is not eligible for model selection.</p>
                    <p>{specialResult.eligibility_reasons.join(', ') || 'Diagnostics require review.'}</p>
                    {typeof specialResult.identifiability_diagnostics?.recommendation === 'string' && (
                      <p className="mt-1">{specialResult.identifiability_diagnostics.recommendation}</p>
                    )}
                  </div>
                )}

                {/* Parameter table */}
                {specialParams.length > 0 && (() => {
                  const hasCI = specialParams.some(p => p.lower_ci != null)
                  return (
                    <div className="mb-4 max-w-xl">
                      <p className="text-xs font-medium text-gray-500 mb-2">Parameters</p>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-200">
                            <th className="text-left py-1 font-medium">Name</th>
                            <th className="text-right py-1 font-medium">Value</th>
                            {hasCI && <th className="text-right py-1 font-medium">Std. Err.</th>}
                            {hasCI && <th className="text-right py-1 font-medium">95% CI</th>}
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          {specialParams.map(p => (
                            <tr key={p.name} className="border-b border-gray-100">
                              <td className="py-1 text-gray-700">{p.name}</td>
                              <td className="py-1 text-right">{fmt(p.value)}</td>
                              {hasCI && <td className="py-1 text-right text-gray-500">{p.std_error != null ? fmt(p.std_error) : '—'}</td>}
                              {hasCI && (
                                <td className="py-1 text-right text-gray-500">
                                  {p.lower_ci != null && p.upper_ci != null ? `[${fmt(p.lower_ci)}, ${fmt(p.upper_ci)}]` : '—'}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {hasCI && (
                        <p className="text-[10px] text-gray-400 mt-1">
                          Normal-approximation CIs from the observed Fisher information (log scale for
                          positive parameters, logit for proportions).
                        </p>
                      )}
                    </div>
                  )
                })()}

                {/* Curves */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {specialSfData.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 360 }}>
                      <Plot
                        data={specialSfData as Plotly.Data[]}
                        layout={{
                          title: { text: plotTitle('special-sf', 'Survival Function (SF)'), font: { size: 13 } },
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
                          title: { text: plotTitle('special-cdf', 'Cumulative Distribution Function (CDF)'), font: { size: 13 } },
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
                  {specialPdfData.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 360 }}>
                      <Plot
                        data={specialPdfData as Plotly.Data[]}
                        layout={{
                          title: { text: plotTitle('special-pdf', 'Probability Density Function (PDF)'), font: { size: 13 } },
                          xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                          yaxis: { title: { text: 'PDF' }, gridcolor: '#e5e7eb' },
                          margin: { t: 40, r: 20, b: 50, l: 60 },
                          paper_bgcolor: 'white', plot_bgcolor: 'white',
                        } as PlotlyLayout}
                        config={{ responsive: true }}
                        style={{ width: '100%', height: '100%' }}
                        useResizeHandler
                      />
                    </div>
                  )}
                  {specialHfData.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 360 }}>
                      <Plot
                        data={specialHfData as Plotly.Data[]}
                        layout={{
                          title: { text: plotTitle('special-hf', 'Hazard Function (HF)'), font: { size: 13 } },
                          xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                          yaxis: { title: { text: 'HF' }, gridcolor: '#e5e7eb' },
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

            {folio.analysisMode === 'nonparametric' && (npResult || turnbullResult) && (
              <div className="flex-1 min-h-0 p-4">
                <Plot
                  data={npPlotData as Plotly.Data[]}
                  layout={{
                    title: { text: plotTitle('np', `${turnbullResult?.method ?? npResult?.method} Estimate`), font: { size: 13 } },
                    xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                    yaxis: { title: { text: turnbullResult || npResult?.method === 'Kaplan-Meier' ? 'Survival Probability' : 'Cumulative Hazard' }, gridcolor: '#e5e7eb' },
                    margin: { t: 40, r: 20, b: 50, l: 60 },
                    paper_bgcolor: 'white', plot_bgcolor: 'white',
                  } as any}
                  config={{ responsive: true }}
                  style={{ width: '100%', height: '100%' }}
                  useResizeHandler
                />
              </div>
            )}

            {folio.analysisMode === 'weibayes' && weibayesResult && (
              <div className="flex-1 overflow-hidden flex">
                {/* Summary + parameters sidebar (mirrors the parametric layout) */}
                <div className="w-80 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-3">
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    Weibayes Fit — <span className="text-green-700 font-semibold">
                      Weibull (β {weibayesResult.beta_assumption})
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="rounded-lg border bg-white border-gray-200 p-2">
                      <p className="text-[10px] text-gray-500">Char. life η</p>
                      <p className="text-sm font-semibold text-gray-900">{fmt(weibayesResult.eta)}</p>
                    </div>
                    <div className="rounded-lg border bg-white border-gray-200 p-2">
                      <p className="text-[10px] text-gray-500">Failures / Total</p>
                      <p className="text-sm font-semibold text-gray-900">{weibayesResult.r} / {weibayesResult.n_total}</p>
                    </div>
                  </div>

                  <p className="text-xs font-medium text-gray-500 mb-2">
                    Parameters <span className="text-gray-400">({Math.round(weibayesResult.CI * 100)}% CI)</span>
                  </p>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-200">
                        <th className="text-left py-1 font-medium">Param</th>
                        <th className="text-right py-1 font-medium">Value</th>
                        <th className="text-right py-1 font-medium">Lower</th>
                        <th className="text-right py-1 font-medium">Upper</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      <tr className="border-b border-gray-100">
                        <td className="py-1 text-gray-700">β ({weibayesResult.beta_assumption})</td>
                        <td className="py-1 text-right">{fmt(weibayesResult.beta)}</td>
                        <td className="py-1 text-right text-gray-500">
                          {fmt(typeof weibayesResult.beta_uncertainty?.beta_lower === 'number'
                            ? weibayesResult.beta_uncertainty.beta_lower : null)}
                        </td>
                        <td className="py-1 text-right text-gray-500">
                          {fmt(typeof weibayesResult.beta_uncertainty?.beta_upper === 'number'
                            ? weibayesResult.beta_uncertainty.beta_upper : null)}
                        </td>
                      </tr>
                      <tr className="border-b border-gray-100">
                        <td className="py-1 text-gray-700">η</td>
                        <td className="py-1 text-right">{fmt(weibayesResult.eta)}</td>
                        <td className="py-1 text-right text-gray-500">{fmt(weibayesResult.eta_lower)}</td>
                        <td className="py-1 text-right text-gray-500">{fmt(weibayesResult.eta_upper)}</td>
                      </tr>
                      {weibayesResult.beta_assumption === 'uncertain' && (
                        <tr className="border-b border-gray-100 bg-blue-50/50">
                          <td className="py-1 text-gray-700">η (β propagated)</td>
                          <td className="py-1 text-right text-gray-400">—</td>
                          <td className="py-1 text-right text-blue-700">{fmt(weibayesResult.eta_propagated_lower)}</td>
                          <td className="py-1 text-right text-blue-700">{fmt(weibayesResult.eta_propagated_upper)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-gray-500 mt-2">
                    Method: {weibayesResult.uncertainty_method.replace(/_/g, ' ')}
                  </p>
                  {weibayesResult.zero_failure && (
                    <p className="text-[11px] text-amber-600 mt-2">
                      Zero-failure case: η is a conservative lower-bound estimate from the suspension data.
                    </p>
                  )}
                </div>

                {/* Shared plot panel (same as Parametric) */}
                {renderPlotPanel()}
              </div>
            )}

            {/* ---------- Competing Failure Modes results ---------- */}
            {folio.analysisMode === 'cfm' && folio.cfmResult && (() => {
              const cfm = folio.cfmResult!
              const MODE_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
                '#ec4899', '#14b8a6', '#6366f1', '#f97316', '#06b6d4']
              return (
                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                  {/* CFM view selector */}
                  <div className="flex gap-1">
                    {([['probability', 'Probability Plots'], ['reliability', 'Curves (SF/CDF/PDF/HF)'], ['params', 'Parameters'], ['simulation', 'MC Simulation']] as const).map(([v, lbl]) => (
                      <button key={v} onClick={() => setCfmView(v)}
                        className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                          cfmView === v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}>{lbl}</button>
                    ))}
                  </div>

                  {/* R(t) query result */}
                  {cfm.system_reliability_at_t && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <p className="text-[10px] text-gray-500">System R(t={cfm.system_reliability_at_t.time})</p>
                        <p className="text-lg font-bold text-blue-700">{(cfm.system_reliability_at_t.system_reliability ?? 0).toFixed(6)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="text-[10px] text-gray-500">System F(t)</p>
                        <p className="text-lg font-semibold text-red-600">{(cfm.system_reliability_at_t.system_unreliability ?? 0).toFixed(6)}</p>
                      </div>
                      {Object.entries(cfm.system_reliability_at_t.mode_reliability ?? {}).map(([mode, r]) => (
                        <div key={mode} className="rounded-lg border border-gray-200 bg-white p-3">
                          <p className="text-[10px] text-gray-500 truncate">R(t) — {mode}</p>
                          <p className="text-sm font-semibold text-gray-800">{(r ?? 0).toFixed(6)}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {cfmView === 'probability' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {cfm.modes.map((m, mi) => {
                        if (m.error || !m.probability_plot) return (
                          <div key={m.mode} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                            <p className="text-xs font-semibold text-gray-600 mb-1">Mode: {m.mode}</p>
                            <p className="text-xs text-red-500">{m.error || 'No probability plot data'}</p>
                          </div>
                        )
                        const pp = m.probability_plot
                        const color = MODE_COLORS[mi % MODE_COLORS.length]
                        return (
                          <div key={m.mode} className="border border-gray-200 rounded-lg bg-white" style={{ height: 350 }}>
                            <Plot
                              data={[
                                { x: pp.scatter_x, y: pp.scatter_y, mode: 'markers', name: `${m.mode} data`,
                                  marker: { color, size: 6 } },
                                { x: pp.line_x, y: pp.line_y, mode: 'lines', name: `${m.mode} fit`,
                                  line: { color, width: 2 } },
                              ] as Plotly.Data[]}
                              layout={{
                                title: { text: plotTitle(`cfm-${m.mode}`, `${m.mode} (${m.n_failures}F, ${m.n_suspensions}S)`), font: { size: 12 } },
                                xaxis: { title: { text: pp.x_label }, gridcolor: '#e5e7eb' },
                                yaxis: { title: { text: pp.y_label }, gridcolor: '#e5e7eb' },
                                margin: { t: 35, r: 15, b: 45, l: 55 },
                                paper_bgcolor: 'white', plot_bgcolor: 'white',
                                showlegend: true, legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                              } as PlotlyLayout}
                              config={{ responsive: true }}
                              style={{ width: '100%', height: '100%' }}
                              useResizeHandler
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {cfmView === 'reliability' && cfm.system_curves && (() => {
                    const sc = cfm.system_curves!
                    // Per-curve-type definition: system series + per-mode series.
                    const CURVE_DEFS: Record<'SF' | 'CDF' | 'PDF' | 'HF', {
                      sys: number[] | undefined; modes?: Record<string, number[]>
                      ylabel: string; range: [number, number] | null; title: string
                    }> = {
                      SF: { sys: sc.system_sf, modes: sc.mode_sf, ylabel: 'Reliability R(t)', range: [0, 1.02], title: 'Survival Function R(t)' },
                      CDF: { sys: sc.system_cdf, modes: sc.mode_cdf, ylabel: 'Unreliability F(t)', range: [0, 1.02], title: 'Unreliability F(t)' },
                      PDF: { sys: sc.system_pdf, modes: sc.mode_pdf, ylabel: 'Density f(t)', range: null, title: 'Probability Density f(t)' },
                      HF: { sys: sc.system_hf, modes: sc.mode_hf, ylabel: 'Hazard h(t)', range: null, title: 'Hazard Function h(t)' },
                    }
                    const ALL_TYPES: Array<'SF' | 'CDF' | 'PDF' | 'HF'> = ['SF', 'CDF', 'PDF', 'HF']

                    const buildCfmCurve = (type: 'SF' | 'CDF' | 'PDF' | 'HF'): Plotly.Data[] => {
                      const def = CURVE_DEFS[type]
                      const traces: Plotly.Data[] = []
                      if (cfmShowModes && def.modes) {
                        Object.entries(def.modes).forEach(([mode, y], i) => {
                          traces.push({ x: sc.x, y, mode: 'lines', name: mode,
                            line: { color: MODE_COLORS[i % MODE_COLORS.length], width: 1.5, dash: 'dash' } } as Plotly.Data)
                        })
                      }
                      if (def.sys) {
                        traces.push({ x: sc.x, y: def.sys, mode: 'lines', name: 'System',
                          line: { color: '#1e293b', width: 2.5 } } as Plotly.Data)
                      }
                      return traces
                    }

                    const cfmLayout = (type: 'SF' | 'CDF' | 'PDF' | 'HF', compact: boolean): PlotlyLayout => {
                      const def = CURVE_DEFS[type]
                      return {
                        title: { text: plotTitle(`cfm-curve-${type}`, def.title), font: { size: 13 } },
                        xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                        yaxis: { title: { text: def.ylabel }, ...(def.range ? { range: def.range } : {}), gridcolor: '#e5e7eb' },
                        margin: { t: 40, r: 20, b: 50, l: 60 },
                        paper_bgcolor: 'white', plot_bgcolor: 'white',
                        showlegend: !compact, legend: { x: 0.02, y: def.range ? 0.02 : 0.98, font: { size: 10 } },
                      } as PlotlyLayout
                    }

                    const exportCurves = () => {
                      const header = ['time', 'system_SF', 'system_CDF', 'system_PDF', 'system_HF']
                      const modeNames = Object.keys(sc.mode_sf)
                      for (const m of modeNames) for (const t of ['SF', 'CDF', 'PDF', 'HF']) header.push(`${m}_${t}`)
                      const lines = [header.join(',')]
                      for (let i = 0; i < sc.x.length; i++) {
                        const row = [sc.x[i], sc.system_sf?.[i], sc.system_cdf?.[i], sc.system_pdf?.[i], sc.system_hf?.[i]]
                        for (const m of modeNames) row.push(sc.mode_sf[m]?.[i], sc.mode_cdf?.[m]?.[i], sc.mode_pdf?.[m]?.[i], sc.mode_hf?.[m]?.[i])
                        lines.push(row.join(','))
                      }
                      const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url; a.download = `cfm_curves_${folio.name}.csv`; a.click(); URL.revokeObjectURL(url)
                    }

                    return (
                      <div className="space-y-3">
                        {/* Toolbar — mirrors the Parametric plot panel */}
                        <div className="flex items-center gap-1 flex-wrap">
                          {ALL_TYPES.map(t => (
                            <button key={t} onClick={e => {
                              const multi = e.ctrlKey || e.metaKey
                              setCfmQuadView(false)
                              setCfmCurveViews(prev => multi
                                ? (prev.includes(t) ? (prev.length > 1 ? prev.filter(x => x !== t) : prev) : [...prev, t])
                                : [t])
                            }}
                              className={`px-3 py-1 text-xs rounded border transition-colors ${
                                !cfmQuadView && cfmCurveViews.includes(t) ? 'bg-blue-600 text-white border-blue-600'
                                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                              }`}>{t}</button>
                          ))}
                          <button onClick={() => setCfmQuadView(q => !q)}
                            title="Show SF, CDF, PDF and HF together in a 2×2 grid"
                            className={`px-3 py-1 text-xs rounded border transition-colors ${
                              cfmQuadView ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                            }`}>Quad view</button>
                          <span className="text-[10px] text-gray-400 ml-0.5 select-none">Ctrl/⌘-click for multiple</span>
                          <label className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer text-gray-600 border-gray-200 hover:bg-gray-50"
                            title="Overlay each mode's curve alongside the system curve">
                            <input type="checkbox" checked={cfmShowModes} onChange={e => setCfmShowModes(e.target.checked)} />
                            Per-mode curves
                          </label>
                          <button onClick={exportCurves}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded">
                            <Download size={12} /> Export CSV
                          </button>
                        </div>

                        {!cfmQuadView && cfmCurveViews.length === 1 && (
                          <div className="flex items-center gap-1">
                            {editingTitle === `cfm-curve-${cfmCurveViews[0]}` ? (
                              <input autoFocus value={editTitleValue} onChange={e => setEditTitleValue(e.target.value)}
                                placeholder={`${plotTitle(`cfm-curve-${cfmCurveViews[0]}`, CURVE_DEFS[cfmCurveViews[0]].title)} (leave empty to reset)`}
                                onBlur={saveTitle} onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') cancelTitle() }}
                                className="flex-1 text-xs border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            ) : (
                              <button onClick={() => startEditTitle(`cfm-curve-${cfmCurveViews[0]}`)}
                                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-blue-600" title="Rename plot title">
                                <Pencil size={10} /> Rename title
                              </button>
                            )}
                          </div>
                        )}

                        {cfmQuadView ? (
                          <div className="grid grid-cols-2 gap-3">
                            {ALL_TYPES.map(t => (
                              <div key={t} className="border border-gray-200 rounded-lg bg-white" style={{ height: 320 }}>
                                <Plot data={buildCfmCurve(t)} layout={cfmLayout(t, true)}
                                  config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
                              </div>
                            ))}
                          </div>
                        ) : (
                          cfmCurveViews.map(t => (
                            <div key={t} className="border border-gray-200 rounded-lg bg-white" style={{ height: 420 }}>
                              <Plot data={buildCfmCurve(t)} layout={cfmLayout(t, false)}
                                config={{ responsive: true, displayModeBar: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
                            </div>
                          ))
                        )}
                      </div>
                    )
                  })()}
                  {cfmView === 'reliability' && !cfm.system_curves && (
                    <p className="text-sm text-gray-400">System curves unavailable — at least 2 modes must fit successfully.</p>
                  )}

                  {cfmView === 'params' && (
                    <div className="space-y-4">
                      <p className="text-xs text-gray-500">Distribution: {cfm.distribution} | Method: {cfm.method} | CI: {Math.round(cfm.CI * 100)}%</p>
                      <table className="w-full text-xs border border-gray-200 rounded overflow-hidden">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Mode</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-600">Failures</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-600">Suspensions</th>
                            {(() => {
                              const firstGood = cfm.modes.find(m => !m.error && Object.keys(m.params).length > 0)
                              if (!firstGood) return null
                              const pNames = Object.keys(firstGood.params).filter(k => !k.endsWith('_lower') && !k.endsWith('_upper') && !k.endsWith('_se'))
                              return pNames.map(p => (
                                <th key={p} className="px-3 py-2 text-right font-medium text-gray-600">{p}</th>
                              ))
                            })()}
                          </tr>
                        </thead>
                        <tbody>
                          {cfm.modes.map(m => {
                            const pNames = Object.keys(m.params).filter(k => !k.endsWith('_lower') && !k.endsWith('_upper') && !k.endsWith('_se'))
                            return (
                              <tr key={m.mode} className="border-t border-gray-100">
                                <td className="px-3 py-1.5 font-medium text-gray-700">{m.mode}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{m.n_failures}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{m.n_suspensions}</td>
                                {m.error ? (
                                  <td colSpan={pNames.length || 1} className="px-3 py-1.5 text-red-500">{m.error}</td>
                                ) : (
                                  pNames.map(p => (
                                    <td key={p} className="px-3 py-1.5 text-right font-mono">
                                      {m.params[p] != null ? fmtNum(m.params[p] as number) : '—'}
                                    </td>
                                  ))
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>

                      {/* Per-mode detailed parameter cards */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {cfm.modes.filter(m => !m.error).map((m, mi) => {
                          const pNames = Object.keys(m.params).filter(k => !k.endsWith('_lower') && !k.endsWith('_upper') && !k.endsWith('_se'))
                          return (
                            <div key={m.mode} className="border border-gray-200 rounded-lg p-3 bg-white">
                              <p className="text-xs font-semibold mb-2" style={{ color: MODE_COLORS[mi % MODE_COLORS.length] }}>
                                {m.mode} — {m.n_failures}F, {m.n_suspensions}S
                              </p>
                              <table className="w-full text-[11px]">
                                <thead><tr className="text-gray-500">
                                  <th className="text-left py-0.5">Param</th>
                                  <th className="text-right py-0.5">Value</th>
                                  <th className="text-right py-0.5">SE</th>
                                  <th className="text-right py-0.5">Lower</th>
                                  <th className="text-right py-0.5">Upper</th>
                                </tr></thead>
                                <tbody className="font-mono">
                                  {pNames.map(p => (
                                    <tr key={p} className="border-t border-gray-100">
                                      <td className="py-0.5 text-gray-700">{p}</td>
                                      <td className="py-0.5 text-right">{fmtNum(m.params[p] as number)}</td>
                                      <td className="py-0.5 text-right text-gray-400">{fmtNum(m.params[`${p}_se`] as number)}</td>
                                      <td className="py-0.5 text-right text-gray-400">{fmtNum(m.params[`${p}_lower`] as number)}</td>
                                      <td className="py-0.5 text-right text-gray-400">{fmtNum(m.params[`${p}_upper`] as number)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {m.gof && Object.keys(m.gof).length > 0 && (
                                <div className="mt-2 flex gap-3 text-[10px] text-gray-400">
                                  {Object.entries(m.gof).map(([k, v]) => (
                                    <span key={k}>{k}: {v != null ? fmtNum(v) : '—'}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {cfmView === 'simulation' && (() => {
                    const mcResult = folio.cfmMcResult
                    const validModes = cfm.modes.filter(m => !m.error && Object.keys(m.params).length > 0)
                    const runMcSim = async () => {
                      if (validModes.length < 2) return
                      setLoading(true)
                      setError(null)
                      try {
                        const nSamples = parseInt(folio.cfmMcSamples ?? '1000', 10)
                        const tRaw = (folio.cfmMcTime ?? '').trim()
                        const tHorizon = tRaw === '' ? null : parseFloat(tRaw)
                        const res = await cfmMonteCarlo({
                          distribution: cfm.distribution,
                          modes: validModes.map(m => {
                            const baseParams: Record<string, number> = {}
                            for (const [k, v] of Object.entries(m.params)) {
                              if (!k.endsWith('_lower') && !k.endsWith('_upper') && !k.endsWith('_se') && v != null)
                                baseParams[k] = v
                            }
                            return { mode: m.mode, params: baseParams }
                          }),
                          n_samples: isFinite(nSamples) && nSamples > 0 ? nSamples : 1000,
                          time_horizon: tHorizon != null && isFinite(tHorizon) && tHorizon > 0 ? tHorizon : null,
                        })
                        patchActive({ cfmMcResult: res })
                      } catch (e: unknown) {
                        setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'MC simulation failed.')
                      } finally {
                        setLoading(false)
                      }
                    }
                    return (
                      <div className="space-y-4">
                        <div className="flex items-end gap-3 flex-wrap">
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Number of units to simulate</label>
                            <input type="text" inputMode="numeric"
                              value={folio.cfmMcSamples ?? '1000'}
                              onChange={e => patchActive({ cfmMcSamples: e.target.value })}
                              className="w-32 text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Test / observation time ({units}, optional)</label>
                            <input type="text" inputMode="decimal" placeholder="none"
                              value={folio.cfmMcTime ?? ''}
                              onChange={e => patchActive({ cfmMcTime: e.target.value })}
                              className="w-40 text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          </div>
                          <button onClick={runMcSim} disabled={loading || validModes.length < 2}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded transition-colors">
                            <Dices size={14} /> {loading ? 'Simulating...' : 'Run MC Simulation'}
                          </button>
                        </div>
                        <p className="text-[10px] text-gray-400">
                          Generates synthetic units using the fitted per-mode distributions. For each unit, the earliest-failing mode determines the failure; other modes become suspensions at that time.
                          {' '}With a test/observation time set, units that survive past it are right-censored (suspended) at that time — yielding a realistic mix of failures and suspensions for a fixed-duration test.
                        </p>

                        {mcResult && (
                          <>
                            {mcResult.time_horizon != null && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                Test time = {fmtNum(mcResult.time_horizon)} {units} · {mcResult.n_failed ?? 0} units failed ·{' '}
                                {mcResult.n_censored ?? 0} units censored (survived the test)
                              </div>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {Object.entries(mcResult.summary).map(([mode, s]) => (
                                <div key={mode} className="rounded-lg border border-gray-200 bg-white p-3">
                                  <p className="text-[10px] text-gray-500 truncate">{mode}</p>
                                  <p className="text-sm font-semibold text-gray-800">{s.n_failures} F / {s.n_suspensions} S</p>
                                  {s.mean_failure_time != null && (
                                    <p className="text-[10px] text-gray-400 mt-0.5">Mean: {fmtNum(s.mean_failure_time)}</p>
                                  )}
                                </div>
                              ))}
                            </div>

                            {mcResult.convergence && (
                              <ConvergencePlot data={mcResult.convergence}
                                label={`Mean system failure time (${units})`} />
                            )}

                            <div className="flex gap-2">
                              <button onClick={() => {
                                const header = ['Unit', 'Time', 'Mode', 'State']
                                const csv = [header.join(','), ...mcResult.rows.map(r =>
                                  [r.unit, r.time, r.mode, r.state].join(',')
                                )].join('\n')
                                const blob = new Blob([csv], { type: 'text/csv' })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement('a')
                                a.href = url; a.download = `cfm_mc_simulation_${mcResult.n_samples}.csv`
                                a.click(); URL.revokeObjectURL(url)
                              }} className="flex items-center gap-1 px-3 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">
                                <Download size={12} /> Export CSV
                              </button>
                            </div>

                            {(() => {
                              // Sort a copy of the rows by the active column; keep a
                              // stable secondary order by unit so ties don't jump around.
                              const sorted = mcResult.rows.map((r, i) => ({ r, i })).sort((a, b) => {
                                const { key, dir } = cfmMcSort
                                const mul = dir === 'asc' ? 1 : -1
                                let cmp = 0
                                if (key === 'unit') cmp = a.r.unit - b.r.unit
                                else if (key === 'time') cmp = a.r.time - b.r.time
                                else if (key === 'mode') cmp = a.r.mode.localeCompare(b.r.mode)
                                else cmp = a.r.state.localeCompare(b.r.state)
                                return cmp !== 0 ? cmp * mul : a.i - b.i
                              })
                              const sortHeader = (key: 'unit' | 'time' | 'mode' | 'state', label: string, align: string) => (
                                <th className={`px-3 py-2 font-medium text-gray-600 cursor-pointer select-none hover:text-blue-600 ${align}`}
                                  onClick={() => setCfmMcSort(s => s.key === key
                                    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                                    : { key, dir: 'asc' })}>
                                  {label}{cfmMcSort.key === key ? (cfmMcSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                                </th>
                              )
                              return (
                                <div className="border border-gray-200 rounded-lg overflow-hidden">
                                  <div className="max-h-96 overflow-auto">
                                    <table className="w-full text-xs">
                                      <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                          {sortHeader('unit', 'Unit', 'text-left')}
                                          {sortHeader('time', 'Time', 'text-right')}
                                          {sortHeader('mode', 'Mode / Group ID', 'text-left')}
                                          {sortHeader('state', 'State', 'text-center')}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {sorted.map(({ r, i }) => (
                                          <tr key={i} className={`border-t border-gray-100 ${r.state === 'F' ? 'bg-red-50/40' : ''}`}>
                                            <td className="px-3 py-1 font-mono text-gray-500">{r.unit}</td>
                                            <td className="px-3 py-1 text-right font-mono">{fmtNum(r.time)}</td>
                                            <td className="px-3 py-1 text-gray-700">{r.mode}</td>
                                            <td className="px-3 py-1 text-center">
                                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                r.state === 'F' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                                              }`}>{r.state === 'F' ? 'Failure' : 'Suspension'}</span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )
                            })()}
                          </>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )
            })()}

            {folio.analysisMode === 'stressstrength' && folio.ssResult && (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-2 gap-4 mb-4 max-w-md">
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-xs text-gray-500">P(failure)</p>
                    <p className="text-lg font-bold text-red-600">{folio.ssResult.probability_of_failure.toExponential(4)}</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs text-gray-500">Reliability</p>
                    <p className="text-lg font-bold text-blue-700">{folio.ssResult.reliability.toFixed(6)}</p>
                  </div>
                </div>
                {folio.ssSource === 'data' && (
                  <p className="text-[11px] text-gray-500 mb-3 font-mono">
                    Stress = {folio.ssStressDist} ({folio.ssStressGroup}): {Object.entries(folio.ssStressParams ?? {}).map(([k, v]) => `${k}=${fmt(parseFloat(v))}`).join(', ')}
                    {'  ·  '}
                    Strength = {folio.ssStrengthDist} ({folio.ssStrengthGroup}): {Object.entries(folio.ssStrengthParams ?? {}).map(([k, v]) => `${k}=${fmt(parseFloat(v))}`).join(', ')}
                  </p>
                )}
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 420 }}>
                  <Plot
                    data={[
                      { x: folio.ssResult.curves.x, y: folio.ssResult.curves.stress_pdf, mode: 'lines',
                        name: `Stress (${folio.ssStressDist ?? 'Normal_2P'})`, line: { color: '#ef4444', width: 2 },
                        fill: 'tozeroy', fillcolor: 'rgba(239,68,68,0.15)' },
                      { x: folio.ssResult.curves.x, y: folio.ssResult.curves.strength_pdf, mode: 'lines',
                        name: `Strength (${folio.ssStrengthDist ?? 'Normal_2P'})`, line: { color: '#3b82f6', width: 2 },
                        fill: 'tozeroy', fillcolor: 'rgba(59,130,246,0.15)' },
                    ] as Plotly.Data[]}
                    layout={{
                      title: { text: plotTitle('ss', 'Stress-Strength Interference'), font: { size: 13 } },
                      xaxis: { title: { text: 'Value' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'PDF' }, gridcolor: '#e5e7eb' },
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

              </div>
            )}

            {!showFitProgress && !currentModeHasResult && (
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
