/**
 * DOE design catalog, module state types, and the pure request builder shared
 * by the main DOE view and the design wizard. Extracted from index.tsx so the
 * wizard can construct and generate a design without touching component state.
 */
import { generateDesign, GenerateDesignResponse, DOEAnalyzeResponse } from '../../api/doe'

export const CATEGORIES = ['Screening', 'Optimization', 'Mixture', 'Full Factorial', 'Robust'] as const
export type Category = typeof CATEGORIES[number]

export interface DesignOption {
  key: string
  label: string
  category: Category
  tip: string
}

export const DESIGNS: DesignOption[] = [
  { key: 'full_factorial_2level', label: 'Full Factorial (2-level)', category: 'Screening',
    tip: '2^k full factorial design with all factor combinations at ±1.' },
  { key: 'fractional_factorial_2level', label: 'Fractional Factorial (2-level)', category: 'Screening',
    tip: '2^(k-p) fractional factorial design. Specify generators (e.g. D=ABC) or a fraction p.' },
  { key: 'plackett_burman', label: 'Plackett-Burman', category: 'Screening',
    tip: 'Orthogonal main-effect screening for 1–63 factors using validated 4–64 run constructions.' },
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

export const TAGUCHI_ARRAYS = ['L4', 'L8', 'L9', 'L12', 'L16', 'L18', 'L27']

export const ALPHA_OPTIONS = [
  { value: 'rotatable', label: 'Rotatable' },
  { value: 'orthogonal', label: 'Orthogonal' },
  { value: 'face', label: 'Face-centered' },
]

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

export interface FactorSpec {
  name: string
  low: string
  high: string
  levels: string  // for general factorial: number of levels
}

export interface DOEState {
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
  nBlocks: string
  standardizedCoefficient: string
  powerAlpha: string
  targetPower: string
  replicates: string
  // Result (persisted for Report Builder asset extraction)
  result: GenerateDesignResponse | null
  // Analysis stage (per-run responses as entered + last analysis result)
  responses: string[]
  analysis: DOEAnalyzeResponse | null
}

export const DEFAULT_FACTORS: FactorSpec[] = [
  { name: 'A', low: '-1', high: '1', levels: '2' },
  { name: 'B', low: '-1', high: '1', levels: '2' },
  { name: 'C', low: '-1', high: '1', levels: '2' },
]

export const INITIAL_STATE: DOEState = {
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
  nBlocks: '1',
  standardizedCoefficient: '0.5',
  powerAlpha: '0.05',
  targetPower: '0.80',
  replicates: '1',
  result: null,
  responses: [],
  analysis: null,
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

export function parseCommaList(s: string): number[] {
  return s.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x))
}

/** Build the /doe/generate request from a given DOE state. Pure — safe to call
 *  with a freshly patched state (e.g. right after the wizard applies one). */
export function buildRequestFrom(s: DOEState): Parameters<typeof generateDesign>[0] {
  const design = DESIGNS.find(d => d.key === s.designKey)
  const designKey = design?.key ?? 'full_factorial_2level'
  const isMixture = design?.category === 'Mixture'
  const isOptimization = design?.category === 'Optimization'
  const isGeneral = designKey === 'full_factorial_general'
  const isTaguchi = designKey === 'taguchi'
  const isFractional = designKey === 'fractional_factorial_2level'
  const showFactors = !isMixture && !isTaguchi
  const showLowHigh = showFactors && !isGeneral

  const req: Parameters<typeof generateDesign>[0] = { design: designKey }

  if (showFactors) {
    req.factor_names = s.factors.map(f => f.name)
  }

  if (isMixture) {
    const qVal = parseInt(s.q, 10)
    if (!isNaN(qVal) && qVal >= 2) req.q = qVal
  }

  if (designKey === 'simplex_lattice') {
    const deg = parseInt(s.degree, 10)
    if (!isNaN(deg) && deg >= 1) req.degree = deg
  }

  if (designKey === 'extreme_vertices') {
    req.lower = parseCommaList(s.mixtureLower)
    req.upper = parseCommaList(s.mixtureUpper)
  }

  if (isFractional) {
    const genStr = s.generators.trim()
    if (genStr) {
      req.generators = genStr.split(/[,;]+/).map(g => g.trim()).filter(Boolean)
    } else {
      const p = parseInt(s.fraction, 10)
      if (!isNaN(p) && p >= 1) req.fraction = p
    }
  }

  if (isOptimization || designKey === 'box_behnken') {
    const cp = parseInt(s.centerPoints, 10)
    if (!isNaN(cp) && cp >= 0) req.center_points = cp
  }

  if (designKey === 'central_composite') {
    if (s.alpha === 'custom') {
      const av = parseFloat(s.customAlpha)
      if (!isNaN(av)) req.alpha = av
    } else {
      req.alpha = s.alpha
    }
  }

  if (isGeneral) {
    req.levels = s.factors.map(f => {
      const lv = parseInt(f.levels, 10)
      return isNaN(lv) ? 2 : lv
    })
  }

  if (isTaguchi) {
    req.taguchi_array = s.taguchiArray
    req.factor_names = s.factors.map(f => f.name)
  }

  // Real-unit mapping for 2-level designs
  if (showLowHigh) {
    const lows = s.factors.map(f => parseFloat(f.low))
    const highs = s.factors.map(f => parseFloat(f.high))
    const hasCustom = lows.some((v, i) => v !== -1 || highs[i] !== 1)
    if (hasCustom && lows.every(v => !isNaN(v)) && highs.every(v => !isNaN(v))) {
      req.low = lows
      req.high = highs
    }
  }

  const nBlocks = parseInt(s.nBlocks ?? '1', 10)
  if (!isNaN(nBlocks) && nBlocks >= 1) req.n_blocks = nBlocks
  const seed = parseInt(s.seed, 10)
  if (!isNaN(seed) && nBlocks > 1) req.block_seed = seed
  if (s.randomize) {
    req.randomize = true
    if (!isNaN(seed)) req.seed = seed
  }
  const coefficient = parseFloat(s.standardizedCoefficient ?? '')
  if (!isNaN(coefficient) && coefficient > 0) req.standardized_coefficient = coefficient
  const powerAlpha = parseFloat(s.powerAlpha ?? '')
  if (!isNaN(powerAlpha) && powerAlpha > 0 && powerAlpha < 1) req.power_alpha = powerAlpha
  const targetPower = parseFloat(s.targetPower ?? '')
  if (!isNaN(targetPower) && targetPower > 0 && targetPower < 1) req.target_power = targetPower
  const replicates = Number(s.replicates ?? '1')
  if (!Number.isInteger(replicates) || replicates < 1 || replicates > 100) {
    throw new Error('Replicates per design point must be a whole number from 1 to 100.')
  }
  req.replicates = replicates

  return req
}
