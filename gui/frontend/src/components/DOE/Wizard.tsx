/**
 * DOE design wizard — walks the user through a short, statistically grounded
 * Q&A (goal → factors → constraints/budget) and recommends an appropriate
 * design with a rationale, run-count estimate, cautions, and alternatives.
 * "Apply & generate" hands a state patch back to the DOE module, which builds
 * and runs the design immediately. UI chrome comes from shared/WizardShell.
 */
import { useState } from 'react'
import WizardShell, { OptionCard, RecommendationCard } from '../shared/WizardShell'
import type { Category, FactorSpec } from './designs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fields the wizard may set on DOEState (all optional except the design). */
export interface WizardPatch {
  category: Category
  designKey: string
  factors?: FactorSpec[]
  generators?: string
  fraction?: string
  centerPoints?: string
  alpha?: string
  q?: string
  degree?: string
  mixtureLower?: string
  mixtureUpper?: string
  taguchiArray?: string
}

export interface Recommendation {
  title: string
  runs: string
  rationale: string
  cautions: string[]
  alternatives: { label: string; note: string }[]
  patch: WizardPatch
}

type Goal = 'screen' | 'optimize' | 'mixture' | 'robust' | 'multilevel'
type Interactions = 'main' | 'twofi' | 'full'
type Budget = 'minimal' | 'moderate' | 'ample'

interface Answers {
  goal: Goal | null
  k: string            // number of factors / components
  interactions: Interactions
  budget: Budget
  corners: 'yes' | 'no'          // optimization: are corner runs feasible?
  region: 'explore' | 'stay'     // optimization: can axial runs exceed the low/high range?
  constrained: 'yes' | 'no'      // mixture: component bounds?
  blend: 'quadratic' | 'cubic' | 'centroid'
  levels: '2' | '3' | 'mixed'    // robust: factor levels
  mLevels: string                // general factorial: levels per factor
}

const INITIAL_ANSWERS: Answers = {
  goal: null, k: '4', interactions: 'twofi', budget: 'moderate',
  corners: 'yes', region: 'explore', constrained: 'no', blend: 'quadratic',
  levels: '2', mLevels: '3',
}

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

const factorList = (k: number, levels = '2'): FactorSpec[] =>
  Array.from({ length: k }, (_, i) =>
    ({ name: String.fromCharCode(65 + i), low: '-1', high: '1', levels }))

const nextMult4 = (n: number) => Math.ceil(n / 4) * 4

/** Resolution of the standard 2^(k-p) designs available via default generators. */
const FRACTION_RES: Record<string, string> = {
  '4,1': 'IV', '5,1': 'V', '5,2': 'III', '6,1': 'VI', '6,2': 'IV', '6,3': 'III',
  '7,1': 'VII', '7,2': 'IV', '7,3': 'IV', '7,4': 'III', '8,2': 'V', '8,3': 'IV', '8,4': 'IV',
}

const choose = (n: number, r: number): number => {
  let out = 1
  for (let i = 0; i < r; i++) out = (out * (n - i)) / (i + 1)
  return Math.round(out)
}

function fullFactorialRec(k: number): Recommendation {
  const runs = 2 ** k
  return {
    title: 'Full Factorial (2-level)',
    runs: `${runs} runs (2^${k})`,
    rationale: `With ${k} factors, a full 2^${k} factorial estimates every main effect and every ` +
      'interaction with no aliasing — the gold standard when the run budget allows it.',
    cautions: runs > 32 ? [`${runs} runs is a large experiment — consider a high-resolution fraction if that is impractical.`] : [],
    alternatives: k >= 4 ? [{
      label: 'Fractional Factorial',
      note: 'Halve or quarter the runs, accepting some aliasing of high-order interactions.',
    }] : [],
    patch: {
      category: 'Screening', designKey: 'full_factorial_2level',
      factors: factorList(k),
    },
  }
}

function fractionRec(k: number, p: number, why: string, cautions: string[] = []): Recommendation {
  const runs = 2 ** (k - p)
  const res = FRACTION_RES[`${k},${p}`] ?? '—'
  return {
    title: `Fractional Factorial 2^(${k}−${p}) — Resolution ${res}`,
    runs: `${runs} runs`,
    rationale: why,
    cautions: [
      ...(res === 'III' ? ['Resolution III: main effects are aliased with two-factor interactions — treat significant effects as candidates to verify, not conclusions.'] : []),
      ...(res === 'IV' ? ['Resolution IV: main effects are clear of two-factor interactions, but some two-factor interactions are aliased with each other.'] : []),
      ...cautions,
    ],
    alternatives: [
      { label: 'Full Factorial (2-level)', note: `${2 ** k} runs, no aliasing.` },
      ...(k >= 6 ? [{ label: 'Plackett-Burman', note: `${nextMult4(k + 1)} runs, main effects only.` }] : []),
    ],
    // fraction drives the default-generator table; generators must be blank
    // or buildRequestFrom would use them instead.
    patch: {
      category: 'Screening', designKey: 'fractional_factorial_2level',
      factors: factorList(k), generators: '', fraction: String(p),
    },
  }
}

function screeningRec(k: number, interactions: Interactions, budget: Budget): Recommendation {
  if (interactions === 'main') {
    if (k <= 3) return fullFactorialRec(k)
    if (k <= 5 && budget !== 'minimal') {
      return fractionRec(k, 1,
        `A half-fraction screens ${k} factors' main effects in ${2 ** (k - 1)} runs while keeping ` +
        'main effects unaliased with each other.')
    }
    const runs = nextMult4(k + 1)
    return {
      title: 'Plackett-Burman',
      runs: `${runs} runs (next multiple of 4 ≥ k+1)`,
      rationale: `Plackett-Burman screens ${k} main effects in only ${runs} runs — the most ` +
        'run-efficient choice when interactions can be assumed negligible at this stage.',
      cautions: ['Resolution III: two-factor interactions partially alias onto main effects. Follow up on the vital few factors with a factorial or response-surface design.'],
      alternatives: [{ label: 'Fractional Factorial', note: 'Slightly more runs, cleaner alias structure for follow-up.' }],
      patch: { category: 'Screening', designKey: 'plackett_burman', factors: factorList(k) },
    }
  }

  if (interactions === 'twofi') {
    if (k <= 3) return fullFactorialRec(k)
    if (k === 4) {
      return budget === 'minimal'
        ? fractionRec(4, 1, 'The 2^(4−1) half-fraction estimates all four main effects in 8 runs.',
            ['Two-factor interactions are aliased in pairs — if one matters, fold over or run the full 16-run factorial.'])
        : fullFactorialRec(4)
    }
    if (k === 5) {
      return budget === 'ample'
        ? fullFactorialRec(5)
        : fractionRec(5, 1, 'The 2^(5−1) half-fraction is Resolution V: every main effect AND every ' +
            'two-factor interaction is estimated clear of the others, in half the runs of the full factorial.')
    }
    if (k === 6) {
      return budget === 'ample'
        ? fractionRec(6, 1, 'The 2^(6−1) half-fraction is Resolution VI — all main effects and two-factor interactions clear — at half the cost of 64 full-factorial runs.')
        : fractionRec(6, 2, 'The 2^(6−2) quarter-fraction screens 6 factors in 16 runs at Resolution IV.')
    }
    if (k === 7) {
      return budget === 'ample'
        ? fractionRec(7, 2, 'The 2^(7−2) design gives 32 runs at Resolution IV with a relatively clean alias structure for 7 factors.')
        : fractionRec(7, 3, 'The 2^(7−3) design screens 7 factors in 16 runs at Resolution IV.')
    }
    if (k === 8) {
      return budget === 'ample'
        ? fractionRec(8, 2, 'The 2^(8−2) design is Resolution V — all main effects and two-factor interactions estimable — in 64 runs instead of 256.')
        : fractionRec(8, budget === 'minimal' ? 4 : 3,
            `A 2^(8−${budget === 'minimal' ? 4 : 3}) fraction screens 8 factors at Resolution IV in ${budget === 'minimal' ? 16 : 32} runs.`)
    }
    // k > 8: too many factors to resolve interactions in one design
    const runs = nextMult4(k + 1)
    return {
      title: 'Plackett-Burman (two-stage strategy)',
      runs: `${runs} runs now + follow-up design`,
      rationale: `${k} factors is too many to estimate two-factor interactions in a single economical design. ` +
        'Standard practice: screen main effects first with Plackett-Burman, then study interactions among the surviving 3–5 factors with a full or Resolution-V factorial.',
      cautions: ['Resolution III first stage — interactions bias main-effect estimates, so confirm the shortlist in stage two.'],
      alternatives: [],
      patch: { category: 'Screening', designKey: 'plackett_burman', factors: factorList(k) },
    }
  }

  // interactions === 'full'
  if (k <= 5) return fullFactorialRec(k)
  if (k === 6) return fractionRec(6, 1, 'At 6 factors a full factorial needs 64 runs. The Resolution-VI half-fraction keeps every main effect and two-factor interaction clean in 32; three-factor and higher interactions (rarely active) are sacrificed.')
  if (k === 7) return fractionRec(7, 1, 'At 7 factors a full factorial needs 128 runs. The Resolution-VII half-fraction preserves all effects up to three-factor interactions in 64.')
  if (k === 8) return fractionRec(8, 2, 'At 8 factors a full factorial needs 256 runs. The Resolution-V quarter-fraction estimates all main effects and two-factor interactions in 64.')
  // k > 8: no default high-resolution fraction exists — screen first.
  const runs = nextMult4(k + 1)
  return {
    title: 'Plackett-Burman (two-stage strategy)',
    runs: `${runs} runs now + follow-up design`,
    rationale: `A complete interaction picture for ${k} factors is impractical in one design ` +
      `(2^${k} = ${2 ** k} runs). Screen main effects first, then run a full factorial on the surviving few.`,
    cautions: ['Resolution III first stage — confirm the shortlist with the follow-up factorial.'],
    alternatives: [],
    patch: { category: 'Screening', designKey: 'plackett_burman', factors: factorList(k) },
  }
}

function optimizeRec(k: number, corners: 'yes' | 'no', region: 'explore' | 'stay'): Recommendation {
  const cpCCD = 4
  const cpBB = 3
  if (k >= 3 && k <= 7 && corners === 'no') {
    const runs = 4 * choose(k, 2) + cpBB
    return {
      title: 'Box-Behnken',
      runs: `≈${runs} runs (edge midpoints + ${cpBB} center points)`,
      rationale: 'Box-Behnken fits a full quadratic response surface without ever running all factors at their ' +
        'extremes simultaneously — the right choice when corner combinations are infeasible, unsafe, or would break the process. All points sit at ±1 or 0.',
      cautions: ['Prediction is weakest at the corners of the region, which the design never visits.'],
      alternatives: [{ label: 'Face-centered CCD', note: 'Includes corners; use if they are actually runnable.' }],
      patch: {
        category: 'Optimization', designKey: 'box_behnken',
        factors: factorList(k), centerPoints: String(cpBB),
      },
    }
  }
  const alpha = region === 'stay' ? 'face' : 'rotatable'
  // The generator switches to a half-fraction factorial core for k ≥ 6.
  const core = k >= 6 ? 2 ** (k - 1) : 2 ** k
  const runs = core + 2 * k + cpCCD
  return {
    title: `Central Composite (${alpha === 'face' ? 'face-centered' : 'rotatable'})`,
    runs: `${runs} runs (${k >= 6 ? `2^(${k}−1) half-fraction` : `2^${k} factorial`} core + ${2 * k} axial + ${cpCCD} center)`,
    rationale: (k === 2
      ? 'With 2 factors the CCD is the standard response-surface design (Box-Behnken needs at least 3). '
      : 'The CCD builds on a factorial core with axial and center points to fit a full quadratic model and detect curvature. ') +
      (alpha === 'face'
        ? 'Face-centered α = 1 keeps every run inside the stated low/high range.'
        : `Rotatable α = (2^${k})^¼ ≈ ${Math.pow(2 ** k, 0.25).toFixed(2)} gives equal prediction variance at ` +
          'equal distance from the center — preferred when axial runs slightly beyond the range are allowed.'),
    cautions: [
      ...(k >= 5 ? [`${runs} runs is substantial at k=${k}; consider screening down to the vital few factors first.`] : []),
      ...(alpha === 'rotatable' ? ['Axial runs fall outside the low/high range — confirm those settings are physically runnable.'] : []),
    ],
    alternatives: (k >= 3 && k <= 7)
      ? [{ label: 'Box-Behnken', note: `≈${4 * choose(k, 2) + cpBB} runs, avoids corner combinations.` }]
      : [],
    patch: {
      category: 'Optimization', designKey: 'central_composite',
      factors: factorList(k), centerPoints: String(cpCCD), alpha,
    },
  }
}

function mixtureRec(q: number, constrained: 'yes' | 'no', blend: Answers['blend']): Recommendation {
  if (constrained === 'yes') {
    return {
      title: 'Extreme Vertices',
      runs: 'depends on the constraints (vertices of the feasible region)',
      rationale: 'When components have lower/upper bounds (e.g. "binder must be 10–40%"), the feasible region is a ' +
        'clipped simplex; extreme-vertices designs place runs at its corners so the whole feasible space is spanned.',
      cautions: ['Edit the lower/upper bounds in the sidebar to your actual component limits before generating (defaults are placeholders). Bounds must admit a non-empty region summing to 1.'],
      alternatives: [{ label: 'Simplex Lattice', note: 'If the bounds are wide enough to be ignorable.' }],
      patch: {
        category: 'Mixture', designKey: 'extreme_vertices', q: String(q),
        mixtureLower: Array(q).fill('0.1').join(','), mixtureUpper: Array(q).fill('0.8').join(','),
      },
    }
  }
  if (blend === 'centroid') {
    return {
      title: 'Simplex Centroid',
      runs: `${2 ** q - 1} runs (all subset blends)`,
      rationale: `The centroid design runs every pure component, every 50/50 binary blend, every ternary blend, up to the overall centroid — ideal for exploring complete blending behavior of ${q} components.`,
      cautions: q >= 5 ? [`${2 ** q - 1} runs grows exponentially with components.`] : [],
      alternatives: [{ label: 'Simplex Lattice {q,2}', note: `${choose(q + 1, 2)} runs, quadratic blending only.` }],
      patch: { category: 'Mixture', designKey: 'simplex_centroid', q: String(q) },
    }
  }
  const m = blend === 'cubic' ? 3 : 2
  const runs = choose(q + m - 1, m)
  return {
    title: `Simplex Lattice {${q}, ${m}}`,
    runs: `${runs} runs`,
    rationale: `The {${q},${m}} lattice spaces component proportions at multiples of 1/${m}, supporting a ` +
      `${m === 2 ? 'quadratic' : 'special cubic'} Scheffé blending model — the standard mixture design when components have no binding constraints.`,
    cautions: [],
    alternatives: [{ label: 'Simplex Centroid', note: `${2 ** q - 1} runs including all multi-component blends.` }],
    patch: { category: 'Mixture', designKey: 'simplex_lattice', q: String(q), degree: String(m) },
  }
}

function robustRec(k: number, levels: Answers['levels']): Recommendation {
  let array = 'L8'
  let runs = 8
  let note = ''
  if (levels === '2') {
    if (k <= 3) { array = 'L4'; runs = 4 }
    else if (k <= 7) { array = 'L8'; runs = 8 }
    else if (k <= 11) { array = 'L12'; runs = 12 }
    else { array = 'L16'; runs = 16 }
    note = `${array} handles up to ${array === 'L4' ? 3 : array === 'L8' ? 7 : array === 'L12' ? 11 : 15} two-level factors.`
  } else if (levels === '3') {
    if (k <= 4) { array = 'L9'; runs = 9 } else { array = 'L27'; runs = 27 }
    note = `${array} handles up to ${array === 'L9' ? 4 : 13} three-level factors.`
  } else {
    array = 'L18'; runs = 18
    note = 'L18 mixes one two-level factor with up to seven three-level factors.'
  }
  return {
    title: `Taguchi ${array} Orthogonal Array`,
    runs: `${runs} runs`,
    rationale: `Orthogonal arrays study many factors in very few balanced runs — the Taguchi approach for making a ` +
      `process robust against noise. ${note}`,
    cautions: [
      'Interactions are heavily confounded — orthogonal arrays assume main effects dominate.',
      levels === '2' && k > 7 && k <= 11 ? 'L12 confounds interactions across ALL columns (no clean interaction columns exist).' : '',
    ].filter(Boolean) as string[],
    alternatives: [{ label: 'Fractional Factorial', note: 'Comparable run counts with an explicit, documented alias structure.' }],
    patch: {
      category: 'Robust', designKey: 'taguchi', taguchiArray: array,
      factors: factorList(k, levels === '3' ? '3' : '2'),
    },
  }
}

function multilevelRec(k: number, m: number): Recommendation {
  const runs = m ** k
  return {
    title: `General Full Factorial (${m} levels)`,
    runs: `${runs} runs (${m}^${k})`,
    rationale: `Factors with ${m} qualitative or coarse quantitative levels can't be coded onto ±1 — the general ` +
      'factorial crosses every level of every factor, estimating all main effects and interactions.',
    cautions: [
      runs > 100 ? `${runs} runs is very large — consider whether some factors could be reduced to 2 levels or screened first.` : '',
      'Levels can be set per factor in the sidebar after applying (they default to the value chosen here).',
    ].filter(Boolean) as string[],
    alternatives: m === 3 && k <= 13 ? [{ label: 'Taguchi L9/L27', note: 'Balanced 3-level subsets in far fewer runs (main effects only).' }] : [],
    patch: {
      category: 'Full Factorial', designKey: 'full_factorial_general',
      factors: factorList(k, String(m)),
    },
  }
}

export function recommend(a: Answers): Recommendation | null {
  const k = parseInt(a.k, 10)
  if (a.goal === null || isNaN(k)) return null
  switch (a.goal) {
    case 'screen': return screeningRec(k, a.interactions, a.budget)
    case 'optimize': return optimizeRec(k, a.corners, a.region)
    case 'mixture': return mixtureRec(k, a.constrained, a.blend)
    case 'robust': return robustRec(k, a.levels)
    case 'multilevel': return multilevelRec(k, Math.max(2, parseInt(a.mLevels, 10) || 3))
  }
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

type StepId = 'goal' | 'k' | 'interactions' | 'budget' | 'shape' | 'constrained' | 'blend' | 'levels' | 'mlevels' | 'rec'

function stepsFor(goal: Goal | null, constrained: 'yes' | 'no'): StepId[] {
  switch (goal) {
    case 'screen': return ['goal', 'k', 'interactions', 'budget', 'rec']
    case 'optimize': return ['goal', 'k', 'shape', 'rec']
    case 'mixture': return constrained === 'yes'
      ? ['goal', 'k', 'constrained', 'rec']
      : ['goal', 'k', 'constrained', 'blend', 'rec']
    case 'robust': return ['goal', 'k', 'levels', 'rec']
    case 'multilevel': return ['goal', 'k', 'mlevels', 'rec']
    default: return ['goal']
  }
}

/** Valid factor-count range per goal (backend/design-table limits). */
function kRange(goal: Goal | null): { min: number; max: number; label: string; hint: string } {
  switch (goal) {
    case 'optimize': return { min: 2, max: 7, label: 'How many factors will you optimize over?', hint: 'Response-surface designs work best over the 2–5 vital factors found by screening.' }
    case 'mixture': return { min: 2, max: 8, label: 'How many mixture components?', hint: 'Components are proportions that sum to 100% (e.g. resin / filler / binder).' }
    case 'robust': return { min: 2, max: 15, label: 'How many control factors?', hint: 'Factors you can set in design, to be made robust against noise.' }
    case 'multilevel': return { min: 2, max: 6, label: 'How many factors?', hint: 'Runs grow as levels^k — keep k small for multi-level factorials.' }
    default: return { min: 2, max: 12, label: 'How many candidate factors?', hint: 'Count every factor you suspect might matter — screening exists to trim this list.' }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DOEWizard({ open, onClose, onApply, busy }: {
  open: boolean
  onClose: () => void
  onApply: (patch: WizardPatch) => void
  busy?: boolean
}) {
  const [a, setA] = useState<Answers>(INITIAL_ANSWERS)
  const [stepIdx, setStepIdx] = useState(0)
  if (!open) return null

  const set = (p: Partial<Answers>) => setA(prev => ({ ...prev, ...p }))
  const steps = stepsFor(a.goal, a.constrained)
  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const kr = kRange(a.goal)
  const kNum = parseInt(a.k, 10)
  const kValid = !isNaN(kNum) && kNum >= kr.min && kNum <= kr.max
  const rec = step === 'rec' ? recommend(a) : null

  const canNext = step === 'goal' ? a.goal !== null
    : step === 'k' ? kValid
    : step === 'mlevels' ? !isNaN(parseInt(a.mLevels, 10)) && parseInt(a.mLevels, 10) >= 2 && parseInt(a.mLevels, 10) <= 6
    : true

  return (
    <WizardShell
      open={open}
      onClose={onClose}
      title="Design wizard"
      stepCount={steps.length}
      stepIdx={stepIdx}
      isFinal={step === 'rec'}
      canNext={canNext}
      onBack={() => setStepIdx(i => i - 1)}
      onNext={() => canNext && setStepIdx(i => i + 1)}
      onRestart={() => { setA(INITIAL_ANSWERS); setStepIdx(0) }}
      onApply={() => rec && onApply(rec.patch)}
      applyLabel={busy ? 'Generating…' : 'Apply & generate design'}
      busy={busy}
    >
      {/* ---- Step: goal ---- */}
      {step === 'goal' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What is the goal of this experiment?</p>
          <OptionCard title="Screen many factors" desc="Find the vital few factors that actually move the response, cheaply." selected={a.goal === 'screen'} onClick={() => set({ goal: 'screen' })} />
          <OptionCard title="Optimize a response" desc="Map curvature and find the best settings of a few known-important factors (response surface)." selected={a.goal === 'optimize'} onClick={() => set({ goal: 'optimize' })} />
          <OptionCard title="Formulate a mixture" desc="Components are proportions that must sum to 100% (recipes, alloys, blends)." selected={a.goal === 'mixture'} onClick={() => set({ goal: 'mixture' })} />
          <OptionCard title="Robustness (Taguchi)" desc="Make the process insensitive to noise using very few balanced runs." selected={a.goal === 'robust'} onClick={() => set({ goal: 'robust' })} />
          <OptionCard title="Multi-level factors" desc="Factors with 3+ qualitative or coarse levels (materials, suppliers, machines)." selected={a.goal === 'multilevel'} onClick={() => set({ goal: 'multilevel' })} />
        </>
      )}

      {/* ---- Step: factor count ---- */}
      {step === 'k' && (
        <>
          <p className="text-xs text-gray-600">{kr.label}</p>
          <input
            type="number" min={kr.min} max={kr.max} value={a.k} autoFocus
            onChange={e => set({ k: e.target.value })}
            className="w-28 text-sm border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          <p className="text-[11px] text-gray-400">{kr.hint} ({kr.min}–{kr.max})</p>
          {!kValid && a.k !== '' && <p className="text-[11px] text-red-500">Enter a whole number between {kr.min} and {kr.max}.</p>}
        </>
      )}

      {/* ---- Screening: interactions ---- */}
      {step === 'interactions' && (
        <>
          <p className="text-xs text-gray-600 mb-1">How much do interactions between factors matter?</p>
          <OptionCard title="Main effects only" desc="First rough screen — assume factors act independently for now." selected={a.interactions === 'main'} onClick={() => set({ interactions: 'main' })} />
          <OptionCard title="Two-factor interactions matter" desc="Pairs of factors may act together (the most common realistic assumption)." selected={a.interactions === 'twofi'} onClick={() => set({ interactions: 'twofi' })} />
          <OptionCard title="All interactions" desc="Nothing may be aliased — I need the complete picture." selected={a.interactions === 'full'} onClick={() => set({ interactions: 'full' })} />
        </>
      )}

      {/* ---- Screening: budget ---- */}
      {step === 'budget' && (
        <>
          <p className="text-xs text-gray-600 mb-1">How tight is the run budget? (each run = one full experiment)</p>
          <OptionCard title="Minimal" desc="Runs are expensive or slow — every run counts." selected={a.budget === 'minimal'} onClick={() => set({ budget: 'minimal' })} />
          <OptionCard title="Moderate" desc="Can afford a sensible number, prefer efficiency." selected={a.budget === 'moderate'} onClick={() => set({ budget: 'moderate' })} />
          <OptionCard title="Ample" desc="Runs are cheap — prioritize information over economy." selected={a.budget === 'ample'} onClick={() => set({ budget: 'ample' })} />
        </>
      )}

      {/* ---- Optimization: region shape ---- */}
      {step === 'shape' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Can you run all factors at their extremes at the same time (the "corners")?</p>
          <OptionCard title="Yes, corners are runnable" desc="No combination of extreme settings is unsafe or infeasible." selected={a.corners === 'yes'} onClick={() => set({ corners: 'yes' })} />
          <OptionCard title="No, avoid the corners" desc="Simultaneous extremes could damage the process or produce nothing measurable." selected={a.corners === 'no'} onClick={() => set({ corners: 'no' })} />
          {a.corners === 'yes' && (
            <>
              <p className="text-xs text-gray-600 mt-2 mb-1">May axial (star) runs go slightly beyond the low/high range?</p>
              <OptionCard title="Yes — allow it" desc="Rotatable α: equal prediction quality in every direction (preferred)." selected={a.region === 'explore'} onClick={() => set({ region: 'explore' })} />
              <OptionCard title="No — stay within bounds" desc="Face-centered α = 1: every run stays inside the stated range." selected={a.region === 'stay'} onClick={() => set({ region: 'stay' })} />
            </>
          )}
        </>
      )}

      {/* ---- Mixture: constraints ---- */}
      {step === 'constrained' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Do any components have lower/upper bounds?</p>
          <OptionCard title="No constraints" desc="Any blend from 0–100% of each component is feasible." selected={a.constrained === 'no'} onClick={() => set({ constrained: 'no' })} />
          <OptionCard title="Yes, bounded components" desc={'Some components have limits (e.g. "surfactant must stay between 5% and 20%").'} selected={a.constrained === 'yes'} onClick={() => set({ constrained: 'yes' })} />
        </>
      )}

      {/* ---- Mixture: blending detail ---- */}
      {step === 'blend' && (
        <>
          <p className="text-xs text-gray-600 mb-1">How detailed a blending model do you need?</p>
          <OptionCard title="Quadratic (standard)" desc="Pure components + all binary blends — fits the usual Scheffé quadratic model." selected={a.blend === 'quadratic'} onClick={() => set({ blend: 'quadratic' })} />
          <OptionCard title="Special cubic" desc="Adds finer spacing for three-way blending effects." selected={a.blend === 'cubic'} onClick={() => set({ blend: 'cubic' })} />
          <OptionCard title="All subset blends (centroid)" desc="Every pure, binary, ternary … blend up to the overall centroid." selected={a.blend === 'centroid'} onClick={() => set({ blend: 'centroid' })} />
        </>
      )}

      {/* ---- Robust: levels ---- */}
      {step === 'levels' && (
        <>
          <p className="text-xs text-gray-600 mb-1">How many levels do your control factors have?</p>
          <OptionCard title="2 levels each" desc="Low/high settings — L4, L8, L12 or L16 arrays." selected={a.levels === '2'} onClick={() => set({ levels: '2' })} />
          <OptionCard title="3 levels each" desc="Low/mid/high — L9 or L27 arrays, can capture curvature." selected={a.levels === '3'} onClick={() => set({ levels: '3' })} />
          <OptionCard title="Mixed 2- and 3-level" desc="One 2-level factor plus several 3-level factors — L18." selected={a.levels === 'mixed'} onClick={() => set({ levels: 'mixed' })} />
        </>
      )}

      {/* ---- General factorial: levels per factor ---- */}
      {step === 'mlevels' && (
        <>
          <p className="text-xs text-gray-600">How many levels per factor?</p>
          <input
            type="number" min={2} max={6} value={a.mLevels} autoFocus
            onChange={e => set({ mLevels: e.target.value })}
            className="w-28 text-sm border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          <p className="text-[11px] text-gray-400">Applied to every factor here; you can vary levels per factor in the sidebar afterwards. (2–6)</p>
        </>
      )}

      {/* ---- Recommendation ---- */}
      {step === 'rec' && rec && (
        <RecommendationCard
          rec={{ title: rec.title, detail: rec.runs, rationale: rec.rationale, cautions: rec.cautions, alternatives: rec.alternatives }}
          footNote="Applying sets the design, factors and options in the sidebar and generates the run matrix. Rename factors and set real low/high units there, then re-generate."
        />
      )}
    </WizardShell>
  )
}
