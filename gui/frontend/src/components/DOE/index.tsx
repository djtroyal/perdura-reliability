import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Download, Play } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import { generateDesign, GenerateDesignResponse } from '../../api/doe'
import { useModuleState } from '../../store/project'

// ---------------------------------------------------------------------------
// Category / design config
// ---------------------------------------------------------------------------

const CATEGORIES = ['Screening', 'Optimization', 'Mixture', 'Full Factorial', 'Robust'] as const
type Category = typeof CATEGORIES[number]

interface DesignOption {
  key: string
  label: string
  category: Category
  tip: string
}

const DESIGNS: DesignOption[] = [
  { key: 'full_factorial_2level', label: 'Full Factorial (2-level)', category: 'Screening',
    tip: '2^k full factorial design with all factor combinations at ±1.' },
  { key: 'fractional_factorial_2level', label: 'Fractional Factorial (2-level)', category: 'Screening',
    tip: '2^(k-p) fractional factorial design. Specify generators (e.g. D=ABC) or a fraction p.' },
  { key: 'plackett_burman', label: 'Plackett-Burman', category: 'Screening',
    tip: 'PB design: N = next multiple of 4 ≥ k+1. Efficient screening for main effects.' },
  { key: 'box_behnken', label: 'Box-Behnken', category: 'Optimization',
    tip: 'Box-Behnken design for k=3..7. No corner runs; all points at ±1 or 0.' },
  { key: 'central_composite', label: 'Central Composite (CCD)', category: 'Optimization',
    tip: 'CCD: factorial + axial + center points. Supports rotatable, orthogonal, and face-centered alpha.' },
  { key: 'simplex_lattice', label: 'Simplex Lattice', category: 'Mixture',
    tip: 'Simplex {q,m} lattice: component proportions at multiples of 1/m, summing to 1.' },
  { key: 'simplex_centroid', label: 'Simplex Centroid', category: 'Mixture',
    tip: 'Centroids of all 2^q-1 non-empty subsets of components.' },
  { key: 'extreme_vertices', label: 'Extreme Vertices', category: 'Mixture',
    tip: 'Vertices of the constrained mixture simplex (box constraints + sum=1).' },
  { key: 'full_factorial_general', label: 'Full Factorial (General)', category: 'Full Factorial',
    tip: 'Cartesian product of all level combinations. Specify the number of levels per factor.' },
  { key: 'taguchi', label: 'Taguchi Orthogonal Array', category: 'Robust',
    tip: 'Standard Taguchi OA: L4, L8, L9, L12, L16, L18, L27.' },
]

const TAGUCHI_ARRAYS = ['L4', 'L8', 'L9', 'L12', 'L16', 'L18', 'L27']

const ALPHA_OPTIONS = [
  { value: 'rotatable', label: 'Rotatable' },
  { value: 'orthogonal', label: 'Orthogonal' },
  { value: 'face', label: 'Face-centered' },
]

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface FactorSpec {
  name: string
  low: string
  high: string
  levels: string  // for general factorial: number of levels
}

interface DOEState {
  category: Category
  designKey: string
  factors: FactorSpec[]
  // Fractional factorial
  generators: string
  fraction: string
  // Optimization
  centerPoints: string
  alpha: string
  customAlpha: string
  // Mixture
  q: string
  degree: string
  mixtureLower: string
  mixtureUpper: string
  // Taguchi
  taguchiArray: string
  // Run order
  randomize: boolean
  seed: string
}

const DEFAULT_FACTORS: FactorSpec[] = [
  { name: 'A', low: '-1', high: '1', levels: '2' },
  { name: 'B', low: '-1', high: '1', levels: '2' },
  { name: 'C', low: '-1', high: '1', levels: '2' },
]

const INITIAL_STATE: DOEState = {
  category: 'Screening',
  designKey: 'full_factorial_2level',
  factors: DEFAULT_FACTORS,
  generators: 'D=ABC',
  fraction: '1',
  centerPoints: '3',
  alpha: 'rotatable',
  customAlpha: '1.414',
  q: '3',
  degree: '2',
  mixtureLower: '0.1,0.1,0.1',
  mixtureUpper: '0.8,0.8,0.8',
  taguchiArray: 'L8',
  randomize: false,
  seed: '',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INPUT_CLS = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const SELECT_CLS = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const BTN_CLS = 'flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors'
const BTN_SM_CLS = 'px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 transition-colors'

function fmtNum(v: number): string {
  if (Math.abs(v) >= 1e4 || (Math.abs(v) > 0 && Math.abs(v) < 0.01)) return v.toExponential(3)
  return parseFloat(v.toFixed(4)).toString()
}

function parseCommaList(s: string): number[] {
  return s.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DOE() {
  const [state, setState] = useModuleState<DOEState>('doe', INITIAL_STATE)
  const [result, setResult] = useState<GenerateDesignResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const patch = (patch: Partial<DOEState>) => setState(s => ({ ...s, ...patch }))

  const designsForCategory = DESIGNS.filter(d => d.category === state.category)
  const selectedDesign = DESIGNS.find(d => d.key === state.designKey) ?? designsForCategory[0]

  // Determine design category when key changes
  const isMixture = selectedDesign?.category === 'Mixture'
  const isScreening = selectedDesign?.category === 'Screening'
  const isOptimization = selectedDesign?.category === 'Optimization'
  const isGeneral = selectedDesign?.key === 'full_factorial_general'
  const isTaguchi = selectedDesign?.key === 'taguchi'
  const isFractional = selectedDesign?.key === 'fractional_factorial_2level'
  const isPB = selectedDesign?.key === 'plackett_burman'

  const showFactors = !isMixture && !isTaguchi
  const showMixture = isMixture
  const showLowHigh = showFactors && !isGeneral && !isMixture
  const showLevelsPerFactor = isGeneral

  // ---------------------------------------------------------------------------
  // Build request
  // ---------------------------------------------------------------------------

  const buildRequest = () => {
    const designKey = selectedDesign?.key ?? 'full_factorial_2level'
    const factorNames = showFactors ? state.factors.map(f => f.name) : undefined

    const req: Parameters<typeof generateDesign>[0] = { design: designKey }

    if (showFactors) {
      req.factor_names = factorNames
    }

    if (isMixture) {
      const qVal = parseInt(state.q, 10)
      if (!isNaN(qVal) && qVal >= 2) req.q = qVal
    }

    if (designKey === 'simplex_lattice') {
      const deg = parseInt(state.degree, 10)
      if (!isNaN(deg) && deg >= 1) req.degree = deg
    }

    if (designKey === 'extreme_vertices') {
      req.lower = parseCommaList(state.mixtureLower)
      req.upper = parseCommaList(state.mixtureUpper)
    }

    if (isFractional) {
      const genStr = state.generators.trim()
      if (genStr) {
        req.generators = genStr.split(/[,;]+/).map(s => s.trim()).filter(Boolean)
      } else {
        const p = parseInt(state.fraction, 10)
        if (!isNaN(p) && p >= 1) req.fraction = p
      }
    }

    if (isOptimization || selectedDesign?.key === 'box_behnken') {
      const cp = parseInt(state.centerPoints, 10)
      if (!isNaN(cp) && cp >= 0) req.center_points = cp
    }

    if (designKey === 'central_composite') {
      if (state.alpha === 'custom') {
        const av = parseFloat(state.customAlpha)
        if (!isNaN(av)) req.alpha = av
      } else {
        req.alpha = state.alpha
      }
    }

    if (isGeneral) {
      req.levels = state.factors.map(f => {
        const lv = parseInt(f.levels, 10)
        return isNaN(lv) ? 2 : lv
      })
    }

    if (isTaguchi) {
      req.taguchi_array = state.taguchiArray
      req.factor_names = state.factors.map(f => f.name)
    }

    // Real-unit mapping for 2-level designs
    if (showLowHigh) {
      const lows = state.factors.map(f => parseFloat(f.low))
      const highs = state.factors.map(f => parseFloat(f.high))
      const hasCustom = lows.some((v, i) => v !== -1 || highs[i] !== 1)
      if (hasCustom && lows.every(v => !isNaN(v)) && highs.every(v => !isNaN(v))) {
        req.low = lows
        req.high = highs
      }
    }

    if (state.randomize) {
      req.randomize = true
      const s = parseInt(state.seed, 10)
      if (!isNaN(s)) req.seed = s
    }

    return req
  }

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  const run = async () => {
    setError(null)
    setLoading(true)
    try {
      const req = buildRequest()
      const res = await generateDesign(req)
      setResult(res)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Error generating design.')
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Export CSV
  // ---------------------------------------------------------------------------

  const exportCSV = () => {
    if (!result) return
    const cols = Object.keys(result.columns)
    const n = result.runs.length
    const header = cols.join(',')
    const rows = Array.from({ length: n }, (_, i) =>
      cols.map(c => {
        const v = result.columns[c][i]
        return typeof v === 'number' ? fmtNum(v) : String(v)
      }).join(',')
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `doe_${selectedDesign?.key ?? 'design'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---------------------------------------------------------------------------
  // Plot data
  // ---------------------------------------------------------------------------

  const plotData = (() => {
    if (!result) return null
    const cols = Object.keys(result.columns)
    // Use coded columns (exclude _real suffix columns)
    const codedCols = cols.filter(c => !c.endsWith('_real'))
    if (codedCols.length < 2) return null

    const k = codedCols.length
    const n = result.runs.length

    if (k === 2) {
      return {
        type: '2d' as const,
        x: result.columns[codedCols[0]] as number[],
        y: result.columns[codedCols[1]] as number[],
        xLabel: codedCols[0],
        yLabel: codedCols[1],
      }
    }
    if (k === 3) {
      return {
        type: '3d' as const,
        x: result.columns[codedCols[0]] as number[],
        y: result.columns[codedCols[1]] as number[],
        z: result.columns[codedCols[2]] as number[],
        xLabel: codedCols[0],
        yLabel: codedCols[1],
        zLabel: codedCols[2],
        n,
      }
    }
    return null
  })()

  // ---------------------------------------------------------------------------
  // Factor management
  // ---------------------------------------------------------------------------

  const addFactor = () =>
    patch({
      factors: [
        ...state.factors,
        { name: String.fromCharCode(65 + state.factors.length), low: '-1', high: '1', levels: '2' },
      ],
    })

  const removeFactor = (idx: number) =>
    patch({ factors: state.factors.filter((_, i) => i !== idx) })

  const updateFactor = (idx: number, field: keyof FactorSpec, value: string) =>
    patch({ factors: state.factors.map((f, i) => i === idx ? { ...f, [field]: value } : f) })

  // ---------------------------------------------------------------------------
  // Metadata display helpers
  // ---------------------------------------------------------------------------

  const metadata = result?.metadata ?? {}
  const metaEntries = Object.entries(metadata).filter(
    ([k]) => !['alias_structure'].includes(k)
  )
  const aliasStructure = metadata['alias_structure'] as Record<string, string[]> | undefined

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full">
      {/* ======================== Left panel ======================== */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">

        {/* Category selector */}
        <div>
          <InfoLabel tip="Choose the class of experimental design to generate.">Design category</InfoLabel>
          <select
            value={state.category}
            onChange={e => {
              const cat = e.target.value as Category
              const firstDesign = DESIGNS.find(d => d.category === cat)
              patch({ category: cat, designKey: firstDesign?.key ?? state.designKey })
            }}
            className={SELECT_CLS}
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Specific design selector */}
        <div>
          <InfoLabel tip={selectedDesign?.tip ?? ''}>Design type</InfoLabel>
          <select
            value={state.designKey}
            onChange={e => patch({ designKey: e.target.value })}
            className={SELECT_CLS}
          >
            {designsForCategory.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>

        {/* ---- Factor names + low/high ---- */}
        {showFactors && (
          <div>
            <InfoLabel tip="Name each factor. For 2-level designs, set Low and High values for real-unit mapping.">
              Factors
            </InfoLabel>
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 text-[10px] text-gray-400 font-medium px-0.5 mb-0.5">
                <span>Name</span>
                {showLowHigh && <><span>Low</span><span>High</span></>}
                {showLevelsPerFactor && <span>Levels</span>}
                <span />
              </div>
              {state.factors.map((f, idx) => (
                <div key={idx} className={`grid gap-1 ${showLowHigh ? 'grid-cols-[1fr_1fr_1fr_auto]' : showLevelsPerFactor ? 'grid-cols-[1fr_1fr_auto]' : 'grid-cols-[1fr_auto]'}`}>
                  <input
                    type="text"
                    value={f.name}
                    onChange={e => updateFactor(idx, 'name', e.target.value)}
                    className="text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                  />
                  {showLowHigh && (
                    <>
                      <input
                        type="text"
                        value={f.low}
                        onChange={e => updateFactor(idx, 'low', e.target.value)}
                        className="text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                        placeholder="-1"
                      />
                      <input
                        type="text"
                        value={f.high}
                        onChange={e => updateFactor(idx, 'high', e.target.value)}
                        className="text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                        placeholder="1"
                      />
                    </>
                  )}
                  {showLevelsPerFactor && (
                    <input
                      type="text"
                      value={f.levels}
                      onChange={e => updateFactor(idx, 'levels', e.target.value)}
                      className="text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                      placeholder="2"
                    />
                  )}
                  <button
                    onClick={() => removeFactor(idx)}
                    disabled={state.factors.length <= 1}
                    className="text-gray-300 hover:text-red-500 disabled:opacity-20 text-xs px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button onClick={addFactor} className={`mt-1.5 w-full ${BTN_SM_CLS} text-blue-600`}>
              + Add factor
            </button>
          </div>
        )}

        {/* ---- Mixture inputs ---- */}
        {showMixture && (
          <div>
            <InfoLabel tip="Number of mixture components (q). Components must sum to 1.">Components (q)</InfoLabel>
            <input type="text" value={state.q} onChange={e => patch({ q: e.target.value })}
              className={INPUT_CLS} placeholder="3" />
          </div>
        )}

        {/* Simplex lattice degree */}
        {selectedDesign?.key === 'simplex_lattice' && (
          <div>
            <InfoLabel tip="Degree m: component values are multiples of 1/m.">Degree (m)</InfoLabel>
            <input type="text" value={state.degree} onChange={e => patch({ degree: e.target.value })}
              className={INPUT_CLS} placeholder="2" />
          </div>
        )}

        {/* Extreme vertices bounds */}
        {selectedDesign?.key === 'extreme_vertices' && (
          <>
            <div>
              <InfoLabel tip="Comma-separated lower bounds for each component.">Lower bounds</InfoLabel>
              <input type="text" value={state.mixtureLower} onChange={e => patch({ mixtureLower: e.target.value })}
                className={INPUT_CLS} placeholder="0.1,0.1,0.1" />
            </div>
            <div>
              <InfoLabel tip="Comma-separated upper bounds for each component.">Upper bounds</InfoLabel>
              <input type="text" value={state.mixtureUpper} onChange={e => patch({ mixtureUpper: e.target.value })}
                className={INPUT_CLS} placeholder="0.8,0.8,0.8" />
            </div>
          </>
        )}

        {/* ---- Fractional factorial inputs ---- */}
        {isFractional && (
          <>
            <div>
              <InfoLabel tip="Generator expressions like D=ABC,E=ABD (comma-separated). Leave blank to use fraction p instead.">Generators</InfoLabel>
              <input type="text" value={state.generators}
                onChange={e => patch({ generators: e.target.value })}
                className={INPUT_CLS} placeholder="D=ABC" />
            </div>
            <div>
              <InfoLabel tip="Number of generators p (used only when Generators is blank).">Fraction p</InfoLabel>
              <input type="text" value={state.fraction}
                onChange={e => patch({ fraction: e.target.value })}
                className={INPUT_CLS} placeholder="1" />
            </div>
          </>
        )}

        {/* ---- Plackett-Burman note ---- */}
        {isPB && (
          <p className="text-[10px] text-gray-500">
            N is automatically chosen as the next multiple of 4 &ge; k+1.
          </p>
        )}

        {/* ---- Center points (BBD + CCD) ---- */}
        {(isOptimization) && (
          <div>
            <InfoLabel tip="Number of center point replicates.">Center points</InfoLabel>
            <input type="text" value={state.centerPoints}
              onChange={e => patch({ centerPoints: e.target.value })}
              className={INPUT_CLS} placeholder="3" />
          </div>
        )}

        {/* ---- CCD alpha ---- */}
        {selectedDesign?.key === 'central_composite' && (
          <div>
            <InfoLabel tip="Alpha controls axial point distance. Rotatable: (2^k)^(1/4). Face-centered: 1. Orthogonal: computed for orthogonality.">Alpha</InfoLabel>
            <select value={state.alpha} onChange={e => patch({ alpha: e.target.value })} className={SELECT_CLS}>
              {ALPHA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="custom">Custom</option>
            </select>
            {state.alpha === 'custom' && (
              <input type="text" value={state.customAlpha}
                onChange={e => patch({ customAlpha: e.target.value })}
                className={`${INPUT_CLS} mt-1`} placeholder="1.414" />
            )}
          </div>
        )}

        {/* ---- Taguchi array selector ---- */}
        {isTaguchi && (
          <>
            <div>
              <InfoLabel tip="Select the standard Taguchi orthogonal array.">Array</InfoLabel>
              <select value={state.taguchiArray} onChange={e => patch({ taguchiArray: e.target.value })}
                className={SELECT_CLS}>
                {TAGUCHI_ARRAYS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <InfoLabel tip="Optional: rename the first N columns. Fewer names than columns is fine.">Factor names (optional)</InfoLabel>
              <div className="flex flex-col gap-1">
                {state.factors.map((f, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_auto] gap-1">
                    <input type="text" value={f.name}
                      onChange={e => updateFactor(idx, 'name', e.target.value)}
                      className="text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono" />
                    <button onClick={() => removeFactor(idx)} disabled={state.factors.length <= 1}
                      className="text-gray-300 hover:text-red-500 disabled:opacity-20 text-xs px-1">×</button>
                  </div>
                ))}
              </div>
              <button onClick={addFactor} className={`mt-1.5 w-full ${BTN_SM_CLS} text-blue-600`}>
                + Add name
              </button>
            </div>
          </>
        )}

        {/* ---- Run order ---- */}
        <div className="border-t border-gray-100 pt-3">
          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" checked={state.randomize}
              onChange={e => patch({ randomize: e.target.checked })}
              className="rounded text-blue-600" />
            Randomize run order
          </label>
          {state.randomize && (
            <div className="mt-1">
              <InfoLabel tip="Random seed for reproducible run order (leave blank for random).">Seed</InfoLabel>
              <input type="text" value={state.seed} onChange={e => patch({ seed: e.target.value })}
                className={INPUT_CLS} placeholder="optional" />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </div>
        )}

        {/* Generate button */}
        <button onClick={run} disabled={loading} className={BTN_CLS}>
          <Play size={14} />
          {loading ? 'Generating...' : 'Generate Design'}
        </button>
      </div>

      {/* ======================== Main area ======================== */}
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">

        {!result ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <p className="text-sm">Configure a design and click Generate.</p>
          </div>
        ) : (
          <div ref={resultsRef}>
            {/* Header + Export */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-800">
                  {(metadata['design_type'] as string) ?? selectedDesign?.label}
                </h2>
                <p className="text-xs text-gray-500">
                  {(metadata['run_count'] as number) ?? result.runs.length} runs
                  {metadata['k'] != null && ` · ${metadata['k']} factors`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ExportResultsButton getElement={() => resultsRef.current} baseName="doe" />
                <button onClick={exportCSV}
                  className="flex items-center gap-1.5 text-xs border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 transition-colors">
                  <Download size={13} /> Export CSV
                </button>
              </div>
            </div>

            {/* Design matrix table */}
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="px-2 py-1.5 border-b border-gray-200 text-right font-medium w-8">#</th>
                    {Object.keys(result.columns).map(col => (
                      <th key={col} className="px-2 py-1.5 border-b border-gray-200 text-right font-medium whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.runs.map((run, i) => (
                    <tr key={i} className="hover:bg-blue-50 transition-colors">
                      <td className="px-2 py-1 border-b border-gray-100 text-right text-gray-400">{i + 1}</td>
                      {Object.keys(result.columns).map(col => {
                        const v = run[col]
                        return (
                          <td key={col} className="px-2 py-1 border-b border-gray-100 text-right font-mono">
                            {typeof v === 'number' ? fmtNum(v) : String(v)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Metadata panel */}
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <h3 className="text-xs font-semibold text-gray-700 mb-2">Design Metadata</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {metaEntries.map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs border-b border-gray-100 last:border-0 py-0.5">
                    <span className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="text-gray-800 font-mono font-semibold text-right max-w-[200px] truncate" title={String(v)}>
                      {typeof v === 'number'
                        ? fmtNum(v)
                        : Array.isArray(v)
                        ? v.join(', ')
                        : String(v)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Alias structure */}
              {aliasStructure && Object.keys(aliasStructure).length > 0 && (
                <div className="mt-3">
                  <h4 className="text-[11px] font-semibold text-gray-600 mb-1">Alias Structure</h4>
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(aliasStructure).map(([effect, aliases]) => (
                      <div key={effect} className="text-[11px] font-mono text-gray-700">
                        <span className="text-blue-700 font-semibold">{effect}</span>
                        {' = '}
                        {aliases.join(' = ')}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Plot for 2-3 factor designs */}
            {plotData && (
              <div className="rounded border border-gray-200 bg-white p-2">
                <h3 className="text-xs font-semibold text-gray-700 mb-1">Design Points</h3>
                {plotData.type === '2d' ? (
                  <Plot
                    data={[{
                      x: plotData.x,
                      y: plotData.y,
                      mode: 'markers',
                      type: 'scatter',
                      marker: { color: '#3b82f6', size: 10, opacity: 0.8,
                        line: { color: '#1d4ed8', width: 1 } },
                      text: result.runs.map((_, i) => `Run ${i + 1}`),
                      hovertemplate: `Run %{text}<br>${plotData.xLabel}: %{x:.4g}<br>${plotData.yLabel}: %{y:.4g}<extra></extra>`,
                    }]}
                    layout={{
                      xaxis: { title: { text: plotData.xLabel }, gridcolor: '#e5e7eb', zeroline: true, zerolinecolor: '#9ca3af' },
                      yaxis: { title: { text: plotData.yLabel }, gridcolor: '#e5e7eb', zeroline: true, zerolinecolor: '#9ca3af' },
                      margin: { t: 20, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white',
                      plot_bgcolor: 'white',
                      height: 350,
                    } as PlotlyLayout}
                    style={{ width: '100%' }}
                    config={{ displayModeBar: false }}
                  />
                ) : (
                  <Plot
                    data={[{
                      x: plotData.x,
                      y: plotData.y,
                      z: plotData.z,
                      mode: 'markers',
                      type: 'scatter3d',
                      marker: { color: '#3b82f6', size: 6, opacity: 0.8,
                        line: { color: '#1d4ed8', width: 1 } },
                      text: result.runs.map((_, i) => `Run ${i + 1}`),
                      hovertemplate: `Run %{text}<br>${plotData.xLabel}: %{x:.4g}<br>${plotData.yLabel}: %{y:.4g}<br>${plotData.zLabel}: %{z:.4g}<extra></extra>`,
                    }]}
                    layout={{
                      scene: {
                        xaxis: { title: plotData.xLabel, gridcolor: '#e5e7eb' },
                        yaxis: { title: plotData.yLabel, gridcolor: '#e5e7eb' },
                        zaxis: { title: plotData.zLabel, gridcolor: '#e5e7eb' },
                      },
                      margin: { t: 20, r: 20, b: 20, l: 20 },
                      paper_bgcolor: 'white',
                      height: 400,
                    } as PlotlyLayout}
                    style={{ width: '100%' }}
                    config={{ displayModeBar: false }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
