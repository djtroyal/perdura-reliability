// At-a-glance project summary for the Dashboard: for each top-level area, does
// it hold input data and/or computed results, how many folios/analyses, and how
// many carry results. Reads the live store (getProjectState) and reuses
// hasComputedResults; call inside a useStoreVersion()-reactive render.

import { getProjectState, hasComputedResults } from './project'

export interface AreaSummary {
  tabId: string
  label: string
  color: string          // Tailwind text color from the nav registry
  hasResults: boolean
  hasInput: boolean
  analyses: number | null          // folio/analysis count (null when N/A)
  analysesWithResults: number
  subTools: number | null          // container sub-tools (null when N/A)
  subToolsWithResults: number
  stale: boolean
  /** Human-readable stale analyses and the reason each is stale. */
  staleDetails: string[]
}

export interface DashboardSummary {
  projectName: string
  units: string
  areas: AreaSummary[]
  areasWithData: number
  totalAreas: number
  totalAnalyses: number
  totalWithResults: number
}

// Area -> the store slices that belong to it, plus (optionally) the slice whose
// folios/analyses we count, and whether it is a container of independent tools.
interface AreaDef {
  tabId: string
  label: string
  color: string
  slices: string[]
  folioSlice?: string        // slice holding a folios[] or analyses[] array
  container?: boolean        // count sub-tools-with-results instead of folios
}

const AREAS: AreaDef[] = [
  { tabId: 'life-data', label: 'Life Data Analysis', color: 'text-blue-500', slices: ['lifeData'], folioSlice: 'lifeData' },
  { tabId: 'alt', label: 'Reliability Testing', color: 'text-amber-500',
    slices: ['alt', 'degradation', 'marginTest', 'expChiSquared', 'rdtBayesian', 'differenceDetection'], folioSlice: 'alt' },
  { tabId: 'system-modeling', label: 'System Modeling', color: 'text-emerald-500', slices: ['system', 'faultTree', 'markov'] },
  { tabId: 'allocation', label: 'Reliability Allocation', color: 'text-lime-600', slices: ['reliabilityAllocation'], folioSlice: 'reliabilityAllocation' },
  { tabId: 'prediction', label: 'Failure Rate Prediction', color: 'text-indigo-500', slices: ['prediction'], folioSlice: 'prediction' },
  { tabId: 'pof', label: 'Physics of Failure', color: 'text-violet-500', slices: ['pof'], folioSlice: 'pof' },
  { tabId: 'growth', label: 'Reliability Growth', color: 'text-green-500', slices: ['growth'], folioSlice: 'growth' },
  { tabId: 'maintenance', label: 'Maintenance', color: 'text-slate-500',
    slices: ['ram', 'maintReplacement', 'maintPMInterval', 'maintCostForecast', 'maintAvailability'], container: true },
  { tabId: 'hra', label: 'Human Reliability', color: 'text-rose-600',
    slices: ['hraTherp', 'hraHeart', 'hraSparH', 'hraCream', 'hraCreamExt', 'hraSlim', 'hraJhedi', 'hraSherpa', 'hraAtheana', 'hraMermos'], container: true },
  { tabId: 'warranty', label: 'Warranty Analysis', color: 'text-cyan-500', slices: ['warranty'], folioSlice: 'warranty' },
  { tabId: 'hypothesis', label: 'Hypothesis Tests', color: 'text-fuchsia-500', slices: ['hypothesis'] },
  { tabId: 'data-analysis', label: 'Statistical Modeling', color: 'text-orange-500',
    slices: ['dataAnalysisData', 'descriptive', 'dataModeling', 'dataAnalysisFolios'], folioSlice: 'dataAnalysisFolios' },
  { tabId: 'six-sigma', label: 'Six Sigma', color: 'text-teal-500', slices: ['sixSigma.capability', 'sixSigma.spc', 'msa', 'doe'], container: true },
  { tabId: 'report-builder', label: 'Report Builder', color: 'text-rose-500', slices: ['reportBuilder'] },
]

// Input-data heuristic: a non-empty array under a data-bearing key, holding at
// least one non-blank scalar. Deliberately conservative — result arrays use
// different key names (line_x, scatter_y, …) so they don't trip this.
const INPUT_KEYS = /^(rows|parts|components|points|failures|samples|runs|responses|stresses|times|quantities|measurements|subgroups|values|columns)$/i

function hasScalar(o: unknown): boolean {
  if (o == null) return false
  if (typeof o === 'string') return o.trim() !== ''
  if (typeof o === 'number') return Number.isFinite(o)
  if (Array.isArray(o)) return o.some(hasScalar)
  if (typeof o === 'object') return Object.values(o as object).some(hasScalar)
  return false
}

function sliceHasInput(slice: unknown): boolean {
  let found = false
  const walk = (o: unknown, depth: number) => {
    if (found || o == null || typeof o !== 'object' || depth > 6) return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (Array.isArray(v) && INPUT_KEYS.test(k) && v.some(hasScalar)) { found = true; return }
      walk(v, depth + 1)
    }
  }
  walk(slice, 0)
  return found
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function foliosOf(slice: any): any[] {
  if (!slice || typeof slice !== 'object') return []
  if (Array.isArray(slice.folios)) return slice.folios
  if (Array.isArray(slice.analyses)) return slice.analyses
  return []
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function folioState(f: any): unknown {
  return f && typeof f === 'object' && 'state' in f ? f.state : f
}

const STALE_SLICE_LABELS: Record<string, string> = {
  system: 'RBD',
  faultTree: 'Fault Tree Analysis',
  markov: 'Markov Analysis',
  descriptive: 'Descriptive Statistics',
  dataModeling: 'Regression & ML',
}

function staleDetailsForSlice(areaLabel: string, sliceKey: string, slice: unknown): string[] {
  if (!slice || typeof slice !== 'object') return []
  const label = STALE_SLICE_LABELS[sliceKey] ?? areaLabel
  const details: string[] = []

  if (sliceKey === 'dataAnalysisFolios') {
    const value = slice as {
      analyses?: { id?: string; name?: string }[]
      dirty?: Record<string, boolean>
    }
    for (const analysis of value.analyses ?? []) {
      if (analysis.id && value.dirty?.[analysis.id]) {
        details.push(
          `${label} — ${analysis.name || 'Untitled analysis'}: dataset or model inputs changed since results were last calculated.`,
        )
      }
    }
    return details
  }

  if (sliceKey === 'lifeData') {
    for (const folio of foliosOf(slice)) {
      const rows = Array.isArray(folio?.rows) ? folio.rows : []
      const currentSignature = JSON.stringify(rows.map((row: { time?: unknown; state?: unknown }) => ({
        t: row?.time,
        s: row?.state,
      })))
      if (hasComputedResults(folio) && folio?.dataSig != null && folio.dataSig !== currentSignature) {
        details.push(
          `${label} — ${folio.name || 'Untitled folio'}: dataset rows changed since distributions were last fitted.`,
        )
      }
    }
    return details
  }

  for (const folio of foliosOf(slice)) {
    if (folio && typeof folio === 'object' && (folio as { dirty?: boolean }).dirty) {
      details.push(
        `${label} — ${String((folio as { name?: unknown }).name ?? 'Untitled analysis')}: inputs changed since results were last calculated.`,
      )
    }
  }
  return details
}

export function computeDashboardSummary(): DashboardSummary {
  const st = getProjectState()
  const modules = st.modules as Record<string, unknown>

  const areas: AreaSummary[] = AREAS.map(def => {
    const hasResults = def.slices.some(k => hasComputedResults(modules[k]))
    const hasInput = hasResults || def.slices.some(k => sliceHasInput(modules[k]))

    let analyses: number | null = null
    let analysesWithResults = 0
    if (def.folioSlice) {
      const folios = foliosOf(modules[def.folioSlice])
      analyses = folios.length
      for (const f of folios) {
        const state = folioState(f)
        if (hasComputedResults(state)) analysesWithResults += 1
      }
    }

    const staleDetails = hasResults
      ? Array.from(new Set(def.slices.flatMap(sliceKey =>
          staleDetailsForSlice(def.label, sliceKey, modules[sliceKey]))))
      : []
    const stale = staleDetails.length > 0

    let subTools: number | null = null
    let subToolsWithResults = 0
    if (def.container) {
      subTools = def.slices.length
      subToolsWithResults = def.slices.filter(k => hasComputedResults(modules[k])).length
    }

    return {
      tabId: def.tabId, label: def.label, color: def.color,
      hasResults, hasInput, analyses, analysesWithResults, subTools, subToolsWithResults,
      stale, staleDetails,
    }
  })

  const totalAnalyses = areas.reduce((s, a) => s + (a.analyses ?? 0), 0)
  const totalWithResults = areas.reduce(
    (s, a) => s + a.analysesWithResults + a.subToolsWithResults, 0)

  return {
    projectName: st.projectName || 'Untitled Project',
    units: st.units,
    areas,
    areasWithData: areas.filter(a => a.hasInput || a.hasResults).length,
    totalAreas: areas.length,
    totalAnalyses,
    totalWithResults,
  }
}
