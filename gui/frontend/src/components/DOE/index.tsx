import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Download, Play, Wand2 } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { generateDesign } from '../../api/doe'
import { useModuleState } from '../../store/project'
import AnalyzePanel from './AnalyzePanel'
import DOEWizard, { WizardPatch } from './Wizard'
import {
  CATEGORIES, Category, DESIGNS, TAGUCHI_ARRAYS, ALPHA_OPTIONS,
  DOEState, FactorSpec, DEFAULT_FACTORS, INITIAL_STATE, buildRequestFrom,
} from './designs'
import { useHelpTopic } from '../help/context'

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DOE() {
  const [state, setState] = useModuleState<DOEState>('doe', INITIAL_STATE)
  useHelpTopic(`sixSigma.doe_${state.designKey}`, 10)
  const result = state.result
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
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
  // Run (request building lives in designs.ts: buildRequestFrom)
  // ---------------------------------------------------------------------------

  const run = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await generateDesign(buildRequestFrom(state))
      // A new design invalidates any previously entered responses/analysis.
      setState(s => ({ ...s, result: res, responses: [], analysis: null }))
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Error generating design.')
    } finally {
      setLoading(false)
    }
  }

  // Apply a wizard recommendation: patch the sidebar configuration, then build
  // and generate from the patched state directly (component `state` is stale
  // within this tick, so the request is built from `next`, not `state`).
  const applyWizard = async (wp: WizardPatch) => {
    setWizardOpen(false)
    const next: DOEState = { ...state, ...wp, result: null, responses: [], analysis: null }
    setState(next)
    setError(null)
    setLoading(true)
    try {
      const res = await generateDesign(buildRequestFrom(next))
      setState(s => ({ ...s, result: res, responses: [], analysis: null }))
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Error generating the recommended design.')
    } finally {
      setLoading(false)
    }
  }

  // Load a canonical 2³ full-factorial example: generates the design, then fills
  // responses from a known model (strong A and C main effects, an A×C interaction,
  // a weak B, plus mild run-to-run scatter) so Analyze reveals the active effects.
  const loadExample = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await generateDesign({ design: 'full_factorial_2level', factor_names: ['A', 'B', 'C'] })
      const A = res.columns['A'] as number[]
      const B = res.columns['B'] as number[]
      const C = res.columns['C'] as number[]
      const responses = A.map((_, i) =>
        (50 + 8 * A[i] + 1 * B[i] + 5 * C[i] + 3 * A[i] * C[i] + ((i % 3) - 1) * 0.4).toFixed(2))
      setState(s => ({
        ...s,
        category: 'Screening',
        designKey: 'full_factorial_2level',
        factors: DEFAULT_FACTORS,
        result: res,
        responses,
        analysis: null,
      }))
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Error loading example design.')
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
    ([k]) => ![
      'alias_structure', 'design_diagnostics', 'power_analysis', 'blocking',
      'randomization', 'analysis_constraints', 'factor_names', 'supported_run_sizes',
    ].includes(k)
  )
  const aliasStructure = metadata['alias_structure'] as Record<string, string[]> | undefined
  const designDiagnostics = metadata['design_diagnostics'] as {
    model?: string; rank?: number; n_parameters?: number; full_rank?: boolean
    residual_df?: number; condition_number?: number | null; replicated_runs?: number
    blocking?: { n_blocks?: number; confounded_with_treatment_model?: boolean }
  } | undefined
  const powerAnalysis = metadata['power_analysis'] as {
    standardized_coefficient?: number; target_power?: number
    current_design?: { minimum_term_power?: number | null } | null
    minimum_replicates_for_target?: number | null
  } | null | undefined
  const blockingMeta = metadata['blocking'] as {
    n_blocks?: number; method?: string; warning?: string
    block_sizes?: Record<string, number>
  } | undefined
  const randomizationMeta = metadata['randomization'] as {
    enabled?: boolean; seed?: number | null; scope?: string; grouped_by_block?: boolean
  } | undefined

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full">
      {/* ======================== Left panel ======================== */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">

        {/* Guided design selection */}
        <button
          onClick={() => setWizardOpen(true)}
          title="Answer a few questions and get a statistically appropriate design recommendation"
          className="flex items-center justify-center gap-2 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded py-2 transition-colors"
        >
          <Wand2 size={13} /> Design wizard — help me choose
        </button>

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
              {/* minmax(0,1fr) tracks + min-w-0 inputs: text inputs otherwise
                  refuse to shrink below their intrinsic width, forcing the
                  whole grid wider than the pane (horizontal scrolling). */}
              {(() => {
                const cols = showLowHigh
                  ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'
                  : showLevelsPerFactor
                    ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]'
                    : 'grid-cols-[minmax(0,1fr)_auto]'
                const inputCls = 'min-w-0 text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono'
                return (
                  <>
                    <div className={`grid ${cols} gap-1 text-[10px] text-gray-400 font-medium px-0.5 mb-0.5`}>
                      <span>Name</span>
                      {showLowHigh && <><span>Low</span><span>High</span></>}
                      {showLevelsPerFactor && <span>Levels</span>}
                      <span className="w-4" />
                    </div>
                    {state.factors.map((f, idx) => (
                      <div key={idx} className={`grid gap-1 ${cols}`}>
                        <input
                          type="text"
                          value={f.name}
                          onChange={e => updateFactor(idx, 'name', e.target.value)}
                          className={inputCls}
                        />
                        {showLowHigh && (
                          <>
                            <input
                              type="text"
                              value={f.low}
                              onChange={e => updateFactor(idx, 'low', e.target.value)}
                              className={inputCls}
                              placeholder="-1"
                            />
                            <input
                              type="text"
                              value={f.high}
                              onChange={e => updateFactor(idx, 'high', e.target.value)}
                              className={inputCls}
                              placeholder="1"
                            />
                          </>
                        )}
                        {showLevelsPerFactor && (
                          <input
                            type="text"
                            value={f.levels}
                            onChange={e => updateFactor(idx, 'levels', e.target.value)}
                            className={inputCls}
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
                  </>
                )
              })()}
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
            Uses a validated 4–64 run construction for 1–63 factors; unsupported
            intermediate sizes advance to the next available orthogonal run size.
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
          {(state.randomize || parseInt(state.nBlocks ?? '1', 10) > 1) && (
            <div className="mt-1">
              <InfoLabel tip="Seed for reproducible block allocation and, when enabled, within-block randomization. Leave blank for a fresh allocation.">Block / run-order seed</InfoLabel>
              <input type="text" value={state.seed} onChange={e => patch({ seed: e.target.value })}
                className={INPUT_CLS} placeholder="optional" />
            </div>
          )}
        </div>

        {/* ---- Blocking and power planning ---- */}
        <div className="border-t border-gray-100 pt-3 flex flex-col gap-2">
          <div>
            <InfoLabel tip="Number of nuisance blocks. Perdura balances coded factors across blocks, includes block fixed effects in analysis, and reports any treatment confounding.">Nuisance blocks</InfoLabel>
            <input type="number" min="1" step="1" value={state.nBlocks ?? '1'}
              onChange={e => patch({ nBlocks: e.target.value })} className={INPUT_CLS} />
          </div>
          <div>
            <InfoLabel tip="Absolute planned coded-model coefficient divided by residual σ. For a two-level factor, the standardized +1 versus −1 effect is twice this value.">Standardized coefficient</InfoLabel>
            <input type="number" min="0" step="0.01" value={state.standardizedCoefficient ?? '0.5'}
              onChange={e => patch({ standardizedCoefficient: e.target.value })} className={INPUT_CLS} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <InfoLabel tip="Two-sided per-term significance level used for noncentral-t planning.">Power α</InfoLabel>
              <input type="number" min="0" max="1" step="0.01" value={state.powerAlpha ?? '0.05'}
                onChange={e => patch({ powerAlpha: e.target.value })} className={INPUT_CLS} />
            </div>
            <div>
              <InfoLabel tip="Minimum requested power across the planned model terms.">Target power</InfoLabel>
              <input type="number" min="0" max="1" step="0.01" value={state.targetPower ?? '0.80'}
                onChange={e => patch({ targetPower: e.target.value })} className={INPUT_CLS} />
            </div>
          </div>
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
        <div className="flex justify-center">
          <ExampleButton hasData={!!result || (state.responses?.length ?? 0) > 0}
            onLoad={loadExample} label="Load example (2³ factorial)" />
        </div>
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

              {designDiagnostics && (
                <div className={`mt-3 rounded border p-2 text-[11px] ${designDiagnostics.full_rank ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                  <b>{designDiagnostics.model?.replace(/_/g, ' ')}</b>: rank {designDiagnostics.rank}/{designDiagnostics.n_parameters},
                  {' '}residual df {designDiagnostics.residual_df}, condition {designDiagnostics.condition_number != null ? fmtNum(designDiagnostics.condition_number) : 'singular'},
                  {' '}replicated runs {designDiagnostics.replicated_runs ?? 0}.
                  {designDiagnostics.blocking?.confounded_with_treatment_model && (
                    <span className="block font-semibold mt-1">Block effects are confounded with the planned treatment model.</span>
                  )}
                </div>
              )}

              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                {blockingMeta && (
                  <div className="rounded border border-gray-200 bg-white p-2">
                    <b>Blocking</b><br />{blockingMeta.n_blocks ?? 1} block(s) · {(blockingMeta.method ?? '').replace(/_/g, ' ')}
                    {blockingMeta.warning && <span className="block text-amber-700 mt-1">{blockingMeta.warning}</span>}
                  </div>
                )}
                {randomizationMeta && (
                  <div className="rounded border border-gray-200 bg-white p-2">
                    <b>Run order</b><br />{randomizationMeta.enabled
                      ? `Randomized ${randomizationMeta.scope?.replace(/_/g, ' ')}`
                      : randomizationMeta.grouped_by_block ? 'Grouped by block; standard within blocks' : 'Standard order'}
                    {randomizationMeta.seed != null && ` · seed ${randomizationMeta.seed}`}
                  </div>
                )}
                {powerAnalysis && (
                  <div className="rounded border border-gray-200 bg-white p-2">
                    <b>Power plan</b><br />Current minimum term power: {powerAnalysis.current_design?.minimum_term_power != null ? `${(100 * powerAnalysis.current_design.minimum_term_power).toFixed(1)}%` : 'no residual df'}.
                    <span className="block">Complete-design replicates for target: {powerAnalysis.minimum_replicates_for_target ?? '> search limit'}.</span>
                  </div>
                )}
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
                      height: 640,
                    } as PlotlyLayout}
                    style={{ width: '100%' }}
                    config={{ displayModeBar: false }}
                  />
                )}
              </div>
            )}

            {/* Model-aware analysis: factorial effects, quadratic response
                surfaces, or Scheffé mixture models as appropriate. */}
            {['screening', 'response_surface', 'mixture'].includes(String(metadata['design_class'])) && (
              <div className="mt-4">
                <AnalyzePanel
                  design={result}
                  factorNames={result.factor_names ?? Object.keys(result.runs[0] ?? {})}
                  responses={state.responses ?? []}
                  analysis={state.analysis ?? null}
                  onChange={p => setState(s => ({ ...s, ...p }))}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <DOEWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onApply={applyWizard} busy={loading} />
    </div>
  )
}
