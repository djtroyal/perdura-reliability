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
import {
  runHypothesisTest,
  runAnova,
  runRMAnova,
  runMixedAnova,
  HypothesisResult,
  AnovaTableRow,
} from '../../api/hypothesis'

// ---------------------------------------------------------------------------
// Test catalogue
// ---------------------------------------------------------------------------

type TestCategory = 'Parametric' | 'Nonparametric' | 'ANOVA' | 'Proportion'

interface TestDef {
  key: string
  label: string
  category: TestCategory
  inputs: InputKind
  tip: string
}

type InputKind =
  | 'one_group'
  | 'two_groups'
  | 'k_groups'
  | 'gof'
  | 'table'
  | 'binomial'
  | 'factorial_anova'
  | 'rm_anova'
  | 'mixed_anova'

const TESTS: TestDef[] = [
  // Parametric
  { key: 'one_sample_t', label: 'One-sample t-test', category: 'Parametric', inputs: 'one_group',
    tip: 'Test whether a sample mean equals a known population mean.' },
  { key: 'two_sample_t', label: 'Two-sample t-test', category: 'Parametric', inputs: 'two_groups',
    tip: "Compare means of two independent groups. Welch's variant by default (unequal variances)." },
  { key: 'paired_t', label: 'Paired t-test', category: 'Parametric', inputs: 'two_groups',
    tip: 'Test mean difference for matched/paired observations.' },
  // Nonparametric
  { key: 'mann_whitney', label: 'Mann-Whitney U', category: 'Nonparametric', inputs: 'two_groups',
    tip: 'Nonparametric test for location shift between two independent groups.' },
  { key: 'wilcoxon_signed_rank', label: 'Wilcoxon Signed-Rank', category: 'Nonparametric', inputs: 'two_groups',
    tip: 'Nonparametric paired test based on signed ranks of differences.' },
  { key: 'kruskal_wallis', label: 'Kruskal-Wallis H', category: 'Nonparametric', inputs: 'k_groups',
    tip: 'Nonparametric one-way ANOVA on ranks. Extends Mann-Whitney to ≥ 3 groups.' },
  { key: 'friedman', label: 'Friedman Test', category: 'Nonparametric', inputs: 'k_groups',
    tip: 'Nonparametric repeated-measures ANOVA (Friedman chi-square).' },
  // ANOVA
  { key: 'one_way_anova', label: 'One-Way ANOVA', category: 'ANOVA', inputs: 'k_groups',
    tip: 'F-test for equal means across ≥ 2 groups. Includes Bonferroni pairwise tests.' },
  { key: 'factorial_anova', label: 'Factorial ANOVA (1–3 way)', category: 'ANOVA', inputs: 'factorial_anova',
    tip: 'Full factorial ANOVA with all interactions for 1, 2, or 3 factors. Paste a data table.' },
  { key: 'rm_anova', label: 'Repeated-Measures ANOVA', category: 'ANOVA', inputs: 'rm_anova',
    tip: 'One within-subject factor RM-ANOVA. Paste a subjects × conditions matrix.' },
  { key: 'mixed_anova', label: 'Mixed ANOVA', category: 'ANOVA', inputs: 'mixed_anova',
    tip: 'One between + one within factor. Provide data in long format (columns: value, subject, between, within).' },
  // Proportion
  { key: 'chi_square_gof', label: 'Chi-Square Goodness-of-Fit', category: 'Proportion', inputs: 'gof',
    tip: 'Test whether observed frequencies fit an expected distribution.' },
  { key: 'chi_square_independence', label: 'Chi-Square Independence', category: 'Proportion', inputs: 'table',
    tip: 'Test independence in a contingency table. Cramér\'s V reported as effect size.' },
  { key: 'binomial_test', label: 'Binomial Test', category: 'Proportion', inputs: 'binomial',
    tip: 'Exact test of a proportion against a null value.' },
]

const CATEGORIES: TestCategory[] = ['Parametric', 'Nonparametric', 'ANOVA', 'Proportion']

const ALTERNATIVE_OPTIONS = [
  { value: 'two-sided', label: 'Two-sided' },
  { value: 'less', label: 'Less' },
  { value: 'greater', label: 'Greater' },
]

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface HypothesisState {
  testKey: string
  // universal
  alpha: string
  alternative: string
  // one-group
  dataText: string
  popmean: string
  // two-groups
  groupAText: string
  groupBText: string
  equalVar: boolean
  // k-groups
  kGroupsText: string
  // chi-square GOF
  observedText: string
  expectedText: string
  useExpected: boolean
  // chi-square table
  tableText: string
  // binomial
  successesText: string
  nText: string
  pText: string
  // factorial ANOVA
  factorialTableText: string
  factorialResponse: string
  factorialFactors: string
  // RM ANOVA
  rmTableText: string
  // Mixed ANOVA — long format
  mixedTableText: string
  mixedSubject: string
  mixedBetween: string
  mixedWithin: string
  mixedValue: string
  // results
  result: HypothesisResult | null
  error: string | null
}

const INITIAL: HypothesisState = {
  testKey: 'one_sample_t',
  alpha: '0.05',
  alternative: 'two-sided',
  dataText: '',
  popmean: '0',
  groupAText: '',
  groupBText: '',
  equalVar: false,
  kGroupsText: '',
  observedText: '',
  expectedText: '',
  useExpected: false,
  tableText: '',
  successesText: '',
  nText: '',
  pText: '0.5',
  factorialTableText: '',
  factorialResponse: '',
  factorialFactors: '',
  rmTableText: '',
  mixedTableText: '',
  mixedSubject: 'subject',
  mixedBetween: 'between',
  mixedWithin: 'within',
  mixedValue: 'value',
  result: null,
  error: null,
}

// Sample data for every test kind, so the "Load example" button populates the
// fields the currently-selected test reads (each test only consumes its own
// fields, so filling them all is harmless and keeps the button test-agnostic).
const EXAMPLE_FILL: Partial<HypothesisState> = {
  dataText: '10.2 11.5 9.8 10.6 11.1 9.4 10.9 10.3 11.8 9.9',
  popmean: '10',
  groupAText: '10.2 11.5 9.8 10.6 11.1 9.4 10.9',
  groupBText: '12.1 13.0 11.6 12.8 13.4 12.2 11.9',
  kGroupsText: '10 12 11 13\n15 14 16 15\n20 19 21 22',
  observedText: '18 22 20 25 15',
  expectedText: '20 20 20 20 20',
  tableText: '10 20\n30 40',
  successesText: '42',
  nText: '100',
  pText: '0.5',
  factorialTableText: 'response,A,B\n5.2,a1,b1\n6.1,a1,b2\n5.8,a2,b1\n6.9,a2,b2\n5.4,a1,b1\n6.3,a1,b2\n5.9,a2,b1\n7.1,a2,b2',
  factorialResponse: 'response',
  factorialFactors: 'A,B',
  rmTableText: '3.2 4.1 5.0\n2.8 3.9 4.5\n3.5 4.8 5.3\n3.0 4.2 4.9',
  mixedTableText: 'value,subject,between,within\n5.2,s1,ctrl,pre\n6.1,s1,ctrl,post\n5.8,s2,ctrl,pre\n6.9,s2,ctrl,post\n7.2,s3,drug,pre\n8.5,s3,drug,post',
}

// Text fields consulted to decide whether the module already holds data.
const EXAMPLE_TEXT_FIELDS: (keyof HypothesisState)[] = [
  'dataText', 'groupAText', 'groupBText', 'kGroupsText', 'observedText',
  'expectedText', 'tableText', 'successesText', 'factorialTableText',
  'rmTableText', 'mixedTableText',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (v: number | null | undefined): string => {
  if (v == null) return '—'
  if (Math.abs(v) < 0.001 || Math.abs(v) >= 10000) return v.toExponential(4)
  return v.toFixed(4)
}

const fmtP = (v: number | null | undefined): string => {
  if (v == null) return '—'
  if (v < 0.0001) return '< 0.0001'
  return v.toFixed(4)
}

function parseLines(text: string): number[] {
  return text.split(/[\n,\s]+/)
    .map(s => parseFloat(s.trim()))
    .filter(n => !isNaN(n))
}

function parseKGroups(text: string): number[][] {
  // Each line is one group; values separated by whitespace or commas
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)
  return lines.map(l => l.split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n)))
}

function parseTable(text: string): number[][] {
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)
  return lines.map(l => l.split(/[\s,\t]+/).map(parseFloat).filter(n => !isNaN(n)))
}

/** Parse CSV/TSV table with header row, return { headers, rows } */
function parseCsvTable(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)
  if (lines.length < 2) return { headers: [], rows: [] }
  const sep = lines[0].includes('\t') ? '\t' : ','
  const headers = lines[0].split(sep).map(h => h.trim())
  const rows = lines.slice(1).map(l => {
    const cells = l.split(sep).map(c => c.trim())
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  })
  return { headers, rows }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldLabel({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return <InfoLabel tip={tip}>{children}</InfoLabel>
}

function Textarea({
  value, onChange, rows = 4, placeholder, onImport,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  /** When set, shows an "Import CSV" affordance that fills this field. */
  onImport?: (text: string) => void
}) {
  return (
    <div>
      {onImport && (
        <div className="flex justify-end mb-1">
          <ImportCsvButton onImport={r => onImport(r.text)} title="Fill this field from a CSV/TSV file" />
        </div>
      )}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
      />
    </div>
  )
}

function Input({
  label, value, onChange, tip, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; tip?: string; type?: string
}) {
  return (
    <div>
      <FieldLabel tip={tip}>{label}</FieldLabel>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </div>
  )
}

function buildInterpretation(result: HypothesisResult): string {
  const pVal = result.p_value
  const alpha = result.alpha
  if (pVal == null) return ''

  const sigText = result.reject_null
    ? `The p-value of ${fmtP(pVal)} is below ${alpha}, indicating a statistically significant result.`
    : `The p-value of ${fmtP(pVal)} is above ${alpha}, so the result is not statistically significant.`

  const testKey = result.test?.toLowerCase() ?? ''

  // t-tests: direction of difference
  if (testKey.includes('t-test') || testKey.includes('t test')) {
    if (result.mean_a != null && result.mean_b != null) {
      const dir = result.mean_a > result.mean_b ? 'higher' : 'lower'
      return `${sigText} Group A's mean (${fmt(result.mean_a)}) is ${dir} than Group B's mean (${fmt(result.mean_b)}).`
    }
    if (result.sample_mean != null && result.popmean != null) {
      const dir = result.sample_mean > result.popmean ? 'above' : 'below'
      return `${sigText} The sample mean (${fmt(result.sample_mean)}) is ${dir} the hypothesized value of ${result.popmean}.`
    }
    if (result.mean_diff != null) {
      const dir = result.mean_diff > 0 ? 'positive' : 'negative'
      return `${sigText} The mean paired difference is ${dir} (${fmt(result.mean_diff)}).`
    }
    return sigText
  }

  // ANOVA / Kruskal-Wallis / Friedman
  if (testKey.includes('anova') || testKey.includes('kruskal') || testKey.includes('friedman')) {
    return result.reject_null
      ? `${sigText} There is evidence that at least one group mean differs from the others.`
      : `${sigText} There is no evidence that the group means differ.`
  }

  // Chi-square
  if (testKey.includes('chi')) {
    if (testKey.includes('independence')) {
      return result.reject_null
        ? `${sigText} There is evidence of an association between the variables.`
        : `${sigText} There is no evidence of an association between the variables.`
    }
    // GOF
    return result.reject_null
      ? `${sigText} The observed frequencies differ significantly from the expected distribution.`
      : `${sigText} The observed frequencies are consistent with the expected distribution.`
  }

  // Mann-Whitney / Wilcoxon
  if (testKey.includes('mann') || testKey.includes('wilcoxon')) {
    return result.reject_null
      ? `${sigText} There is evidence of a difference in the distributions of the two groups.`
      : `${sigText} There is no evidence of a difference in the distributions of the two groups.`
  }

  // Binomial
  if (testKey.includes('binomial')) {
    return result.reject_null
      ? `${sigText} The observed proportion differs significantly from the hypothesized value of ${result.p_null ?? 0.5}.`
      : `${sigText} The observed proportion is consistent with the hypothesized value of ${result.p_null ?? 0.5}.`
  }

  // Normality (Shapiro-Wilk etc.)
  if (testKey.includes('normality') || testKey.includes('shapiro')) {
    return result.reject_null
      ? `${sigText} The data do not appear to follow a normal distribution.`
      : `${sigText} The data appear consistent with a normal distribution.`
  }

  return sigText
}

function ResultCard({ result }: { result: HypothesisResult }) {
  const reject = result.reject_null
  const interpretation = buildInterpretation(result)
  return (
    <div className={`rounded-lg border p-4 ${reject ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-800">{result.test}</span>
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${reject ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {reject ? 'Reject H₀' : 'Fail to Reject H₀'}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <StatBox label="Statistic" value={fmt(result.statistic)} />
        <StatBox label="p-value" value={fmtP(result.p_value)} accent={reject} />
        <StatBox label="α" value={fmt(result.alpha)} />
        {result.effect_size != null && (
          <StatBox label={result.effect_size_name ?? 'Effect size'} value={fmt(result.effect_size)} />
        )}
        {result.df != null && typeof result.df === 'number' && (
          <StatBox label="df" value={String(result.df)} />
        )}
        {result.df != null && typeof result.df === 'object' && !Array.isArray(result.df) && (
          Object.entries(result.df).map(([k, v]) => (
            <StatBox key={k} label={`df (${k})`} value={String(v)} />
          ))
        )}
      </div>
      <p className="text-xs text-gray-700 italic">{result.interpretation}</p>
      {interpretation && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
          <p className="text-xs font-medium text-blue-800 mb-1">Interpretation</p>
          <p className="text-xs text-blue-700">{interpretation}</p>
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded border bg-white border-gray-200 px-3 py-2">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-bold font-mono ${accent ? 'text-red-600' : 'text-gray-800'}`}>{value}</p>
    </div>
  )
}

function AnovaTable({ rows }: { rows: AnovaTableRow[] }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg mt-4">
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            {['Source', 'SS', 'df', 'MS', 'F', 'p-value', 'Partial η²', 'Sig.'].map(h => (
              <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={`border-t border-gray-100 ${row.source === 'Total' ? 'bg-gray-50 font-medium' : ''}`}>
              <td className="px-3 py-1.5 font-medium text-gray-800">{row.source}</td>
              <td className="px-3 py-1.5 font-mono text-right">{fmt(row.SS)}</td>
              <td className="px-3 py-1.5 font-mono text-right">{row.df ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-right">{fmt(row.MS)}</td>
              <td className="px-3 py-1.5 font-mono text-right">{fmt(row.F)}</td>
              <td className={`px-3 py-1.5 font-mono text-right ${row.significant ? 'text-red-600 font-bold' : ''}`}>
                {fmtP(row.p_value)}
              </td>
              <td className="px-3 py-1.5 font-mono text-right">{fmt(row.partial_eta_sq)}</td>
              <td className="px-3 py-1.5 text-center">
                {row.significant === true ? '✓' : row.significant === false ? '' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BoxPlot({ groups, labels }: { groups: number[][]; labels: string[] }) {
  if (groups.length === 0 || groups.every(g => g.length === 0)) return null
  const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
  const traces = groups.map((g, i) => ({
    y: g,
    type: 'box' as const,
    name: labels[i] ?? `Group ${i + 1}`,
    marker: { color: COLORS[i % COLORS.length] },
    boxpoints: 'all' as const,
    jitter: 0.3,
    pointpos: -1.8,
  }))
  return (
    <div className="mt-4 border border-gray-200 rounded-lg bg-white" style={{ height: 320 }}>
      <Plot
        data={traces}
        layout={{
          margin: { t: 20, r: 20, b: 40, l: 50 },
          paper_bgcolor: 'white',
          plot_bgcolor: 'white',
          showlegend: false,
          yaxis: { gridcolor: '#e5e7eb', title: { text: 'Value' } },
        } as PlotlyLayout}
        config={{ responsive: true }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Hypothesis() {
  const [state, setState] = useModuleState<HypothesisState>('hypothesis', INITIAL)
  const [loading, setLoading] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)

  const patch = (p: Partial<HypothesisState>) => setState(s => ({ ...s, ...p }))

  const activeDef = TESTS.find(t => t.key === state.testKey) ?? TESTS[0]

  // ---- build box-plot groups from current inputs ----
  const boxPlotGroups = (): { groups: number[][]; labels: string[] } => {
    const inputs = activeDef.inputs
    if (inputs === 'one_group') {
      const g = parseLines(state.dataText)
      return g.length > 0 ? { groups: [g], labels: ['Sample'] } : { groups: [], labels: [] }
    }
    if (inputs === 'two_groups') {
      const a = parseLines(state.groupAText)
      const b = parseLines(state.groupBText)
      return { groups: [a, b].filter(g => g.length > 0), labels: ['Group A', 'Group B'] }
    }
    if (inputs === 'k_groups') {
      const gs = parseKGroups(state.kGroupsText).filter(g => g.length > 0)
      return { groups: gs, labels: gs.map((_, i) => `Group ${i + 1}`) }
    }
    return { groups: [], labels: [] }
  }

  // ---- run ----
  const handleRun = async () => {
    setLoading(true)
    patch({ error: null, result: null })
    const alpha = parseFloat(state.alpha)
    if (isNaN(alpha) || alpha <= 0 || alpha >= 1) {
      patch({ error: 'Alpha must be between 0 and 1.', result: null })
      setLoading(false)
      return
    }
    try {
      let result: HypothesisResult
      const { inputs, key } = activeDef

      if (inputs === 'factorial_anova') {
        const { headers, rows } = parseCsvTable(state.factorialTableText)
        if (headers.length === 0 || rows.length === 0) throw new Error('Paste a table with a header row.')
        const responseCol = state.factorialResponse.trim() || headers[0]
        const factorCols = state.factorialFactors.split(',').map(s => s.trim()).filter(Boolean)
        if (factorCols.length === 0) throw new Error('Enter at least one factor column name.')
        const responseValues = rows.map(r => parseFloat(r[responseCol])).filter(n => !isNaN(n))
        const factors: Record<string, string[]> = {}
        factorCols.forEach(f => { factors[f] = rows.map(r => r[f] ?? '') })
        result = await runAnova({ response: responseValues, factors, factor_names: factorCols, alpha })
      } else if (inputs === 'rm_anova') {
        const mat = parseTable(state.rmTableText)
        if (mat.length === 0) throw new Error('Paste a subjects × conditions matrix.')
        result = await runRMAnova({ data: mat, alpha })
      } else if (inputs === 'mixed_anova') {
        const { headers, rows } = parseCsvTable(state.mixedTableText)
        if (headers.length === 0) throw new Error('Paste a long-format table with a header row.')
        const valCol = state.mixedValue.trim() || 'value'
        const subjCol = state.mixedSubject.trim() || 'subject'
        const betCol = state.mixedBetween.trim() || 'between'
        const witCol = state.mixedWithin.trim() || 'within'
        const values = rows.map(r => parseFloat(r[valCol])).filter(n => !isNaN(n))
        const subjects = rows.map(r => r[subjCol] ?? '')
        const between = rows.map(r => r[betCol] ?? '')
        const within = rows.map(r => r[witCol] ?? '')
        result = await runMixedAnova({ values, subjects, between_factor: between, within_factor: within, alpha })
      } else if (inputs === 'gof') {
        const observed = parseLines(state.observedText)
        const expected = state.useExpected ? parseLines(state.expectedText) : undefined
        result = await runHypothesisTest({ test: key, observed, expected, alpha })
      } else if (inputs === 'table') {
        const table = parseTable(state.tableText)
        result = await runHypothesisTest({ test: key, table, alpha })
      } else if (inputs === 'binomial') {
        const successes = parseInt(state.successesText, 10)
        const n = parseInt(state.nText, 10)
        const p = parseFloat(state.pText)
        result = await runHypothesisTest({ test: key, successes, n, p, alpha, alternative: state.alternative })
      } else if (inputs === 'one_group') {
        const data = parseLines(state.dataText)
        const popmean = parseFloat(state.popmean)
        result = await runHypothesisTest({ test: key, data, popmean, alpha, alternative: state.alternative })
      } else if (inputs === 'two_groups') {
        const group_a = parseLines(state.groupAText)
        const group_b = parseLines(state.groupBText)
        result = await runHypothesisTest({
          test: key, group_a, group_b, alpha, alternative: state.alternative,
          equal_var: key === 'two_sample_t' ? state.equalVar : undefined,
        })
      } else {
        // k_groups
        const groups = parseKGroups(state.kGroupsText)
        result = await runHypothesisTest({ test: key, groups, alpha })
      }

      patch({ result, error: null })
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      patch({ error: detail ?? String(e), result: null })
    } finally {
      setLoading(false)
    }
  }

  const { groups: bpGroups, labels: bpLabels } = boxPlotGroups()

  // ---- render ----
  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Category + test selector */}
        <div>
          <FieldLabel tip="Choose a hypothesis test category.">Test category</FieldLabel>
          <div className="flex flex-wrap gap-1 mb-2">
            {CATEGORIES.map(cat => {
              const isActive = TESTS.find(t => t.key === state.testKey)?.category === cat
              return (
                <button key={cat}
                  onClick={() => {
                    const first = TESTS.find(t => t.category === cat)
                    if (first) patch({ testKey: first.key, result: null, error: null })
                  }}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-600 hover:border-blue-400'
                  }`}>
                  {cat}
                </button>
              )
            })}
          </div>
          <select
            value={state.testKey}
            onChange={e => patch({ testKey: e.target.value, result: null, error: null })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
            {TESTS.filter(t => t.category === activeDef.category).map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          {activeDef.tip && (
            <p className="text-[10px] text-gray-500 mt-1 leading-snug">{activeDef.tip}</p>
          )}
        </div>

        {/* Alpha */}
        <Input label="Significance level (α)" value={state.alpha} onChange={v => patch({ alpha: v })}
          tip="Type I error rate. Commonly 0.05." />

        {/* Alternative (shown for relevant tests) */}
        {['one_group', 'two_groups', 'binomial'].includes(activeDef.inputs) && (
          <div>
            <FieldLabel tip="Direction of the alternative hypothesis.">Alternative hypothesis</FieldLabel>
            <select value={state.alternative} onChange={e => patch({ alternative: e.target.value })}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {ALTERNATIVE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {/* --- Input panels per test kind --- */}

        <div className="flex justify-end -mt-1">
          <ExampleButton
            hasData={EXAMPLE_TEXT_FIELDS.some(k => String(state[k] ?? '').trim() !== '')}
            onLoad={() => patch(EXAMPLE_FILL)}
          />
        </div>

        {activeDef.inputs === 'one_group' && (
          <>
            <div>
              <FieldLabel tip="Enter numeric values, one per line or space/comma-separated.">Sample data</FieldLabel>
              <Textarea value={state.dataText} onChange={v => patch({ dataText: v })}
                placeholder={'10.2\n11.5\n9.8\n...'} rows={5} />
            </div>
            <Input label="Population mean (μ₀)" value={state.popmean} onChange={v => patch({ popmean: v })}
              tip="Hypothesized population mean to test against." />
          </>
        )}

        {activeDef.inputs === 'two_groups' && (
          <>
            <div>
              <FieldLabel tip="Group A values, one per line or space/comma-separated.">Group A</FieldLabel>
              <Textarea value={state.groupAText} onChange={v => patch({ groupAText: v })}
                placeholder={'10.2\n11.5\n9.8'} rows={4} />
            </div>
            <div>
              <FieldLabel tip="Group B values (or after/post measurements for paired tests).">Group B</FieldLabel>
              <Textarea value={state.groupBText} onChange={v => patch({ groupBText: v })}
                placeholder={'12.1\n10.9\n11.4'} rows={4} />
            </div>
            {activeDef.key === 'two_sample_t' && (
              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input type="checkbox" checked={state.equalVar}
                  onChange={e => patch({ equalVar: e.target.checked })}
                  className="rounded text-blue-600" />
                Assume equal variances (Student's t)
              </label>
            )}
          </>
        )}

        {activeDef.inputs === 'k_groups' && (
          <div>
            <FieldLabel tip="Paste one group per line. Values within a line are space or comma-separated.">
              Groups (one per line)
            </FieldLabel>
            <Textarea value={state.kGroupsText} onChange={v => patch({ kGroupsText: v })} onImport={t => patch({ kGroupsText: t })}
              placeholder={'10 12 11 13\n15 14 16 15\n20 19 21 22'} rows={6} />
          </div>
        )}

        {activeDef.inputs === 'gof' && (
          <>
            <div>
              <FieldLabel tip="Observed counts, space or comma-separated.">Observed frequencies</FieldLabel>
              <Textarea value={state.observedText} onChange={v => patch({ observedText: v })}
                placeholder={'20 18 22 19 21'} rows={2} />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={state.useExpected}
                onChange={e => patch({ useExpected: e.target.checked })}
                className="rounded text-blue-600" />
              Specify expected frequencies
            </label>
            {state.useExpected && (
              <div>
                <FieldLabel tip="Expected counts (must sum to same total as observed, or be proportional).">
                  Expected frequencies
                </FieldLabel>
                <Textarea value={state.expectedText} onChange={v => patch({ expectedText: v })}
                  placeholder={'20 20 20 20 20'} rows={2} />
              </div>
            )}
          </>
        )}

        {activeDef.inputs === 'table' && (
          <div>
            <FieldLabel tip="Contingency table — one row per line, values space or comma-separated.">
              Contingency table
            </FieldLabel>
            <Textarea value={state.tableText} onChange={v => patch({ tableText: v })} onImport={t => patch({ tableText: t })}
              placeholder={'10 20\n30 40'} rows={4} />
          </div>
        )}

        {activeDef.inputs === 'binomial' && (
          <>
            <Input label="Successes" value={state.successesText} onChange={v => patch({ successesText: v })}
              tip="Number of successes observed." />
            <Input label="Trials (n)" value={state.nText} onChange={v => patch({ nText: v })}
              tip="Total number of trials." />
            <Input label="Null probability (p₀)" value={state.pText} onChange={v => patch({ pText: v })}
              tip="Hypothesized success probability under H₀." />
          </>
        )}

        {activeDef.inputs === 'factorial_anova' && (
          <>
            <div>
              <FieldLabel tip="Paste a CSV or tab-delimited table with a header row. First row = column names.">
                Data table (with header)
              </FieldLabel>
              <Textarea value={state.factorialTableText} onChange={v => patch({ factorialTableText: v })} onImport={t => patch({ factorialTableText: t })}
                placeholder={'response,A,B\n5.2,a1,b1\n6.1,a1,b2\n...'} rows={6} />
            </div>
            <Input label="Response column" value={state.factorialResponse}
              onChange={v => patch({ factorialResponse: v })}
              tip="Name of the numeric response variable column." />
            <Input label="Factor column(s) (comma-separated)" value={state.factorialFactors}
              onChange={v => patch({ factorialFactors: v })}
              tip="Names of 1–3 factor columns, e.g. A or A,B or A,B,C." />
          </>
        )}

        {activeDef.inputs === 'rm_anova' && (
          <div>
            <FieldLabel tip="Paste a matrix: one row per subject, one column per condition. No header row.">
              Data matrix (subjects × conditions)
            </FieldLabel>
            <Textarea value={state.rmTableText} onChange={v => patch({ rmTableText: v })} onImport={t => patch({ rmTableText: t })}
              placeholder={'3.2 4.1 5.0\n2.8 3.9 4.5\n3.5 4.8 5.3'} rows={5} />
          </div>
        )}

        {activeDef.inputs === 'mixed_anova' && (
          <>
            <div>
              <FieldLabel tip="Long-format CSV/TSV table with header row.">
                Long-format data (with header)
              </FieldLabel>
              <Textarea value={state.mixedTableText} onChange={v => patch({ mixedTableText: v })} onImport={t => patch({ mixedTableText: t })}
                placeholder={'value,subject,between,within\n5.2,s1,ctrl,pre\n...'} rows={5} />
            </div>
            <Input label="Value column" value={state.mixedValue} onChange={v => patch({ mixedValue: v })} />
            <Input label="Subject column" value={state.mixedSubject} onChange={v => patch({ mixedSubject: v })} />
            <Input label="Between-subjects column" value={state.mixedBetween} onChange={v => patch({ mixedBetween: v })} />
            <Input label="Within-subjects column" value={state.mixedWithin} onChange={v => patch({ mixedWithin: v })} />
          </>
        )}

        {/* Error */}
        {state.error && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
            {state.error}
          </div>
        )}

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors">
          <Play size={14} />
          {loading ? 'Computing...' : 'Run Test'}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4">
        {!state.result ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Configure inputs and click <strong className="mx-1">Run Test</strong> to see results.
          </div>
        ) : (
          <div ref={resultsRef} className="max-w-4xl">
            <div className="flex justify-end mb-3">
              <ExportResultsButton getElement={() => resultsRef.current} baseName="hypothesis" />
            </div>
            {/* Result card */}
            <ResultCard result={state.result} />

            {/* Group statistics (two-sample / one-sample) */}
            {(state.result.mean_a != null || state.result.sample_mean != null) && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {state.result.sample_mean != null && (
                  <>
                    <StatBox label="Sample mean" value={fmt(state.result.sample_mean)} />
                    <StatBox label="Sample SD" value={fmt(state.result.sample_sd)} />
                    <StatBox label="n" value={String(state.result.n ?? '—')} />
                  </>
                )}
                {state.result.mean_a != null && (
                  <>
                    <StatBox label="Mean A" value={fmt(state.result.mean_a)} />
                    <StatBox label="SD A" value={fmt(state.result.sd_a)} />
                    <StatBox label="n A" value={String(state.result.n_a ?? '—')} />
                    <StatBox label="Mean B" value={fmt(state.result.mean_b)} />
                    <StatBox label="SD B" value={fmt(state.result.sd_b)} />
                    <StatBox label="n B" value={String(state.result.n_b ?? '—')} />
                  </>
                )}
                {state.result.mean_diff != null && (
                  <>
                    <StatBox label="Mean diff" value={fmt(state.result.mean_diff)} />
                    <StatBox label="SD diff" value={fmt(state.result.sd_diff)} />
                  </>
                )}
              </div>
            )}

            {/* Group means summary (k-group) */}
            {state.result.group_means && state.result.group_means.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-700 mb-2">Group summary</p>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Group</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">n</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Mean</th>
                        {state.result.group_sds && <th className="px-3 py-2 text-right font-medium text-gray-600">SD</th>}
                        {state.result.group_medians && <th className="px-3 py-2 text-right font-medium text-gray-600">Median</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {state.result.group_means.map((m, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 font-medium text-gray-800">Group {i + 1}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{state.result?.group_ns?.[i] ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(m)}</td>
                          {state.result?.group_sds && (
                            <td className="px-3 py-1.5 text-right font-mono">{fmt(state.result.group_sds[i])}</td>
                          )}
                          {state.result?.group_medians && (
                            <td className="px-3 py-1.5 text-right font-mono">{fmt(state.result.group_medians[i])}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Mixed ANOVA sub-effects */}
            {state.result.between_factor && (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {([
                  { label: 'Between factor', ef: state.result.between_factor },
                  { label: 'Within factor', ef: state.result.within_factor },
                  { label: 'Interaction', ef: state.result.interaction },
                ] as { label: string; ef: typeof state.result.between_factor }[]).map(({ label, ef }) => ef && (
                  <div key={label} className={`rounded-lg border p-3 ${ef.reject_null ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                    <p className="text-xs font-semibold text-gray-700 mb-1">{label}</p>
                    <p className="text-xs font-mono">F = {fmt(ef.F)}</p>
                    <p className="text-xs font-mono">p = {fmtP(ef.p_value)}</p>
                    <p className={`text-xs font-bold mt-1 ${ef.reject_null ? 'text-red-600' : 'text-green-700'}`}>
                      {ef.reject_null ? 'Significant' : 'ns'}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* ANOVA table */}
            {state.result.anova_table && state.result.anova_table.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-700 mb-1">ANOVA Table</p>
                {state.result.balance_note && (
                  <p className="text-[10px] text-gray-500 mb-1">{state.result.balance_note}</p>
                )}
                <AnovaTable rows={state.result.anova_table} />
              </div>
            )}

            {/* Pairwise comparisons (one-way ANOVA) */}
            {state.result.pairwise_bonferroni && state.result.pairwise_bonferroni.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-700 mb-2">Pairwise comparisons (Bonferroni corrected)</p>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Groups</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Mean diff</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">p (raw)</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">p (Bonferroni)</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-600">Sig.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.result.pairwise_bonferroni.map((pw, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-1.5">{pw.group_i + 1} vs {pw.group_j + 1}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(pw.mean_diff)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmtP(pw.p_value_raw)}</td>
                          <td className={`px-3 py-1.5 text-right font-mono ${pw.significant ? 'text-red-600 font-bold' : ''}`}>
                            {fmtP(pw.p_value_bonferroni)}
                          </td>
                          <td className="px-3 py-1.5 text-center">{pw.significant ? '✓' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Box plots */}
            {bpGroups.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-700 mb-1">Distribution overview</p>
                <BoxPlot groups={bpGroups} labels={bpLabels} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
