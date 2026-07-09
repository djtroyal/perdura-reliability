/**
 * Reliability-test navigator — guides the user through the ~24 tools of the
 * Reliability Testing module (ALT fitting, demonstration tests, test planning,
 * degradation, screening) and jumps to the right tool with a rationale.
 */
import { useState } from 'react'
import WizardShell, { OptionCard, RecommendationCard, RecInfo } from '../shared/WizardShell'

export type TopView = 'alt' | 'rdt' | 'design' | 'degradation'

export interface ToolRecommendation extends RecInfo {
  view: TopView
  /** altTab id for view 'alt'; ToolTabs id for the other views. */
  sub: string
}

type Goal = 'accelerated' | 'demonstrate' | 'plan' | 'degradation' | 'screening'
type Profile = 'constant' | 'stepped' | 'two' | 'limits' | 'af'
type Basis = 'exponential' | 'weibull' | 'none' | 'prior' | 'margin'
type PlanGoal = 'exp' | 'duration' | 'zerofail' | 'sequential' | 'proportion' | 'whatif'
type PropKind = 'one' | 'two'
type WhatIf = 'expected' | 'simulation' | 'difference' | 'gof'
type Screen = 'limits' | 'ess' | 'hass' | 'burnin'

interface Answers {
  goal: Goal | null
  profile: Profile
  basis: Basis
  planGoal: PlanGoal
  propKind: PropKind
  whatIf: WhatIf
  screen: Screen
}

const INITIAL: Answers = {
  goal: null, profile: 'constant', basis: 'exponential', planGoal: 'exp',
  propKind: 'one', whatIf: 'expected', screen: 'limits',
}

// ---------------------------------------------------------------------------
// Decision engine
// ---------------------------------------------------------------------------

const R = (view: TopView, sub: string, title: string, detail: string, rationale: string,
  cautions: string[] = [], alternatives: { label: string; note: string }[] = []): ToolRecommendation =>
  ({ view, sub, title, detail, rationale, cautions, alternatives })

export function recommend(a: Answers): ToolRecommendation | null {
  if (a.goal === null) return null

  if (a.goal === 'accelerated') {
    switch (a.profile) {
      case 'constant':
        return R('alt', 'model', 'Life-Stress Model fitting', 'Failure times at 2+ constant stress levels',
          'With failures collected at several constant stress levels, fitting a life-stress model (Arrhenius/Eyring/power × Weibull/Lognormal/Normal/Exponential) extrapolates life to the use-level stress. The module fits all 12 combinations and ranks them by AICc.',
          ['Extrapolation is only valid while the same failure mechanism operates — confirm failure modes match across stress levels.'])
      case 'stepped':
        return R('alt', 'step', 'Step / Sequential Stress analysis', 'Failure times under a stepped stress profile',
          'When stress is increased in planned steps on the same units, the cumulative-exposure model converts each failure to an equivalent time at the reference stress before fitting the life distribution.',
          ['Requires the step profile (stress + duration per step) to be recorded accurately.'])
      case 'two':
        return R('alt', 'multi', 'Multi-Stress analysis', 'Failure times under two simultaneous stresses',
          'With two stresses applied together (e.g. temperature + humidity), a log-linear life model with both stress terms fits their joint effect and extrapolates to the use condition of each.',
          ['Aim for at least 3 distinct combinations of the two stresses to separate their effects.'])
      case 'limits':
        return R('alt', 'halt', 'HALT (Highly Accelerated Life Test)', 'Step-search outcomes: pass / anomaly / fail per stress level',
          'HALT steps stress upward until anomalies and failures appear, revealing the operating and destruct limits and the design margin over spec — a discovery test for robustness, not a quantitative life estimate.',
          ['HALT results are qualitative margins; they do not produce a use-level life prediction.'])
      case 'af':
        return R('alt', 'accel', 'Acceleration Factor calculator', 'Known model parameters + test/use stress levels',
          'When the life-stress model and its parameters are already established (e.g. a known activation energy), the AF calculator converts directly between test and use conditions — Arrhenius, Eyring, inverse power, Coffin-Manson, Peck, Norris-Landzberg, or Black.',
          ['The AF is only as good as the assumed parameters — cite their source (e.g. Ea from prior testing or literature).'])
    }
  }

  if (a.goal === 'demonstrate') {
    switch (a.basis) {
      case 'exponential':
        return R('rdt', 'chisquared', 'Exponential Chi-Squared demonstration', 'Solve test time, MTTF, or confidence given allowed failures',
          'For constant-failure-rate (exponential) assumptions, the chi-squared relation links total test time, allowed failures, confidence, and demonstrated MTTF — the standard electronics-reliability demonstration calculation.',
          ['The exponential assumption (no wear-out during the demonstration window) should be defensible for the product.'])
      case 'weibull':
        return R('rdt', 'parametric', 'Parametric Binomial demonstration', 'Sample size or test duration given a known Weibull β',
          'Knowing the failure mode\'s Weibull shape β lets you trade test DURATION against SAMPLE SIZE: testing longer than the mission time earns extra credit through the β exponent (parametric binomial).',
          ['β must come from prior knowledge of the same failure mode — a wrong β silently scales the whole demonstration.'])
      case 'none':
        return R('rdt', 'nonparametric', 'Non-Parametric Binomial demonstration', 'Sample size for a reliability target at given confidence',
          'With no distribution assumption, the success-run binomial gives the classic answer: how many units must survive the mission time (with how many allowed failures) to demonstrate R at confidence C.',
          ['Requires each unit to be tested for the full mission time — no duration credit without a distribution assumption.'])
      case 'prior':
        return R('rdt', 'bayesian', 'Bayesian (Beta prior) demonstration', 'Prior knowledge (expert or subsystem data) + test evidence',
          'Prior evidence — expert estimates or subsystem test data — encoded as a Beta prior reduces the demonstration burden: the posterior combines what you already know with the new test results.',
          ['Document and defend the prior; an optimistic prior weakens the demonstration\'s credibility.'])
      case 'margin':
        return R('alt', 'margin', 'Margin Test', 'Zero-failure test at elevated stress + acceleration factor',
          'A margin test demonstrates reliability quickly by testing at elevated stress and converting through the acceleration factor — the zero-failure success-run math applied at the accelerated condition.',
          ['Both the AF and the zero-failure assumption must hold; a single failure ends the demonstration.'])
    }
  }

  if (a.goal === 'plan') {
    switch (a.planGoal) {
      case 'exp':
        return R('design', 'exp-planner', 'Exponential Test Planner', 'Solve any of: units, duration, failures, confidence, MTBF',
          'For exponential (constant-rate) test planning, this solves whichever variable is unknown — units × duration needed for a target MTBF at confidence, or what an existing plan can demonstrate.')
      case 'duration':
        return R('design', 'duration', 'Test Duration calculator', 'Time each unit must run for a Weibull reliability target',
          'Given a Weibull β and the number of units available, this computes how long each must run (without failure) to demonstrate the reliability target — the duration-side view of the parametric binomial.')
      case 'zerofail':
        return R('design', 'no-failures', 'Zero-Failure Sample Size', 'Units needed when no failures are allowed',
          'The success-run formula: how many units must all survive the mission to demonstrate R at confidence C. The most common quick sizing question in reliability demonstration.',
          ['Sample sizes explode as R → 1: demonstrating 99% at 90% confidence takes 229 units. Consider a Bayesian or parametric approach if that is impractical.'])
      case 'sequential':
        return R('design', 'sequential', 'Sequential Sampling (SPRT)', 'Accept/reject boundaries updated as results arrive',
          'Wald\'s sequential probability ratio test decides accept/reject/continue after EVERY result, typically finishing far sooner than a fixed-size plan with the same risks.',
          ['Requires the discipline to stop when the boundary is crossed — peeking rules must be agreed in advance.'])
      case 'proportion':
        return a.propKind === 'one'
          ? R('design', 'one-proportion', 'One-Sample Proportion test', 'Observed pass/fail count vs a target proportion',
              'Tests whether an observed proportion (e.g. field survival fraction) meets a required value — the attribute-data workhorse.')
          : R('design', 'two-proportion', 'Two-Proportion test', 'Compare pass/fail results of two designs/vendors',
              'Compares two observed proportions (design A vs design B, old vs new supplier) with a formal significance test rather than eyeballing percentages.')
      case 'whatif':
        switch (a.whatIf) {
          case 'expected':
            return R('design', 'expected', 'Expected Failure Times', 'Predicted failure times for a planned test',
              'Given an assumed life distribution, this predicts WHEN failures should occur during the planned test — useful for scheduling inspections and sanity-checking test length.')
          case 'simulation':
            return R('design', 'simulation', 'Test Simulation', 'Monte-Carlo outcomes of a candidate test plan',
              'Simulates the planned test many times under an assumed truth, showing the distribution of outcomes (pass rate, failures observed) before any hardware is committed.')
          case 'difference':
            return R('design', 'difference', 'Difference Detection Matrix', 'Test time needed to statistically separate two designs',
              'Shows how long a comparison test must run before a given true difference in life (B10, MTBF…) between two designs becomes statistically detectable — prevents underpowered A/B tests.')
          case 'gof':
            return R('design', 'gof', 'Goodness of Fit', 'Check a distribution assumption against failure data',
              'Validates the distribution assumption behind your plan (Anderson-Darling and friends) — worth doing before trusting any parametric demonstration math.')
        }
        break
    }
  }

  if (a.goal === 'degradation') {
    return R('degradation', 'degradation', 'Degradation Testing', 'Repeated measurements (or destructive strength tests) over time',
      'When failures are too slow to observe, measuring a degradation parameter (wear, drift, strength loss) and extrapolating each unit to a failure threshold converts degradation paths into pseudo failure times for standard life analysis. Choose Non-Destructive (repeated measurements per unit) or Destructive (one measurement per unit) inside the tool.',
      ['The degradation model (linear/exponential) and threshold choice drive the answer — check the path fits before trusting the life estimates.'])
  }

  // screening
  switch (a.screen) {
    case 'limits':
      return R('alt', 'halt', 'HALT (design margin discovery)', 'Step stress upward to find operating & destruct limits',
        'In development, HALT finds the design\'s true operating and destruct limits so weaknesses can be fixed and margins established — it is the precursor that makes production screens (HASS) meaningful.',
        ['HALT is a discovery tool, not a pass/fail gate; expect (and want) failures.'])
    case 'ess':
      return R('degradation', 'ess', 'ESS (Environmental Stress Screening)', 'Screen strength/duration for precipitating latent defects',
        'ESS applies controlled stress (thermal cycling, vibration) to EVERY production unit to precipitate latent defects into detectable failures before shipment — this tool sizes the screen\'s strength and duration.',
        ['Screens consume life: verify the screen leaves adequate margin for good units.'])
    case 'hass':
      return R('degradation', 'hass', 'HASS (Highly Accelerated Stress Screen)', 'Production screen derived from HALT limits',
        'HASS screens production units at stresses beyond spec but inside the HALT-established limits — faster and more effective than classical ESS, but only valid once HALT margins are known.',
        ['Requires prior HALT results; re-validate the screen (proof-of-screen) so it does not damage good units.'])
    case 'burnin':
      return R('degradation', 'burn-in', 'Burn-In Design', 'Burn-in duration economics for infant mortality',
        'When a weak subpopulation causes infant mortality, burn-in operates units before shipment so early failures happen in the factory instead of the field — this tool balances burn-in cost against warranty savings.',
        ['Burn-in only pays when a genuine weak subpopulation exists (decreasing hazard) — confirm with life-data analysis first.'])
  }
  return null
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type StepId = 'goal' | 'profile' | 'basis' | 'plangoal' | 'propkind' | 'whatif' | 'screen' | 'rec'

function stepsFor(a: Answers): StepId[] {
  switch (a.goal) {
    case 'accelerated': return ['goal', 'profile', 'rec']
    case 'demonstrate': return ['goal', 'basis', 'rec']
    case 'plan':
      if (a.planGoal === 'proportion') return ['goal', 'plangoal', 'propkind', 'rec']
      if (a.planGoal === 'whatif') return ['goal', 'plangoal', 'whatif', 'rec']
      return ['goal', 'plangoal', 'rec']
    case 'degradation': return ['goal', 'rec']
    case 'screening': return ['goal', 'screen', 'rec']
    default: return ['goal']
  }
}

export default function ReliabilityTestNavigator({ open, onClose, onApply }: {
  open: boolean
  onClose: () => void
  onApply: (rec: ToolRecommendation) => void
}) {
  const [a, setA] = useState<Answers>(INITIAL)
  const [stepIdx, setStepIdx] = useState(0)
  if (!open) return null

  const set = (p: Partial<Answers>) => setA(prev => ({ ...prev, ...p }))
  const steps = stepsFor(a)
  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const rec = step === 'rec' ? recommend(a) : null

  return (
    <WizardShell
      open={open}
      onClose={onClose}
      title="Test navigator"
      stepCount={steps.length}
      stepIdx={stepIdx}
      isFinal={step === 'rec'}
      canNext={step !== 'goal' || a.goal !== null}
      onBack={() => setStepIdx(i => i - 1)}
      onNext={() => setStepIdx(i => i + 1)}
      onRestart={() => { setA(INITIAL); setStepIdx(0) }}
      onApply={() => rec && onApply(rec)}
      applyLabel="Open this tool"
    >
      {step === 'goal' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What are you trying to do?</p>
          <OptionCard title="Analyze accelerated failure data" desc="I have failure times at elevated stress and want use-level life." selected={a.goal === 'accelerated'} onClick={() => set({ goal: 'accelerated' })} />
          <OptionCard title="Demonstrate a reliability target" desc="Prove R ≥ target at some confidence with a test (RDT)." selected={a.goal === 'demonstrate'} onClick={() => set({ goal: 'demonstrate' })} />
          <OptionCard title="Plan a test before running it" desc="Sample sizes, durations, sequential plans, power to detect differences." selected={a.goal === 'plan'} onClick={() => set({ goal: 'plan' })} />
          <OptionCard title="Failures are too slow — measure degradation" desc="Track a degradation parameter and extrapolate to a failure threshold." selected={a.goal === 'degradation'} onClick={() => set({ goal: 'degradation' })} />
          <OptionCard title="Screen out latent defects" desc="HALT margins, ESS/HASS screens, burn-in economics." selected={a.goal === 'screening'} onClick={() => set({ goal: 'screening' })} />
        </>
      )}

      {step === 'profile' && (
        <>
          <p className="text-xs text-gray-600 mb-1">How was stress applied?</p>
          <OptionCard title="Constant levels" desc="Groups of units each at a fixed elevated stress (2+ levels)." selected={a.profile === 'constant'} onClick={() => set({ profile: 'constant' })} />
          <OptionCard title="Stepped profile" desc="Stress increased in planned steps on the same units." selected={a.profile === 'stepped'} onClick={() => set({ profile: 'stepped' })} />
          <OptionCard title="Two stresses at once" desc="e.g. temperature and humidity applied simultaneously." selected={a.profile === 'two'} onClick={() => set({ profile: 'two' })} />
          <OptionCard title="Step-search for limits (HALT)" desc="Increase stress until anomalies/failures to find operating & destruct limits." selected={a.profile === 'limits'} onClick={() => set({ profile: 'limits' })} />
          <OptionCard title="Just convert with a known model" desc="I already know the model parameters — compute an acceleration factor." selected={a.profile === 'af'} onClick={() => set({ profile: 'af' })} />
        </>
      )}

      {step === 'basis' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What can the demonstration lean on?</p>
          <OptionCard title="Constant failure rate (exponential)" desc="MTBF-style demonstration — electronics, repairable systems." selected={a.basis === 'exponential'} onClick={() => set({ basis: 'exponential' })} />
          <OptionCard title="Known Weibull shape β" desc="Trade test duration against sample size using prior knowledge of β." selected={a.basis === 'weibull'} onClick={() => set({ basis: 'weibull' })} />
          <OptionCard title="No distribution assumption" desc="Pure pass/fail success-run at the mission time." selected={a.basis === 'none'} onClick={() => set({ basis: 'none' })} />
          <OptionCard title="Prior knowledge to credit" desc="Expert estimates or subsystem data reduce the test burden (Bayesian)." selected={a.basis === 'prior'} onClick={() => set({ basis: 'prior' })} />
          <OptionCard title="Elevated-stress margin test" desc="Zero-failure demonstration at accelerated stress via a known AF." selected={a.basis === 'margin'} onClick={() => set({ basis: 'margin' })} />
        </>
      )}

      {step === 'plangoal' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What are you sizing or checking?</p>
          <OptionCard title="Exponential test plan" desc="Units / duration / failures / confidence for an MTBF target." selected={a.planGoal === 'exp'} onClick={() => set({ planGoal: 'exp' })} />
          <OptionCard title="Test duration (Weibull)" desc="How long must my units run to show the target?" selected={a.planGoal === 'duration'} onClick={() => set({ planGoal: 'duration' })} />
          <OptionCard title="Zero-failure sample size" desc="How many units must all survive the mission?" selected={a.planGoal === 'zerofail'} onClick={() => set({ planGoal: 'zerofail' })} />
          <OptionCard title="Sequential accept/reject" desc="Decide as results arrive (SPRT) instead of a fixed plan." selected={a.planGoal === 'sequential'} onClick={() => set({ planGoal: 'sequential' })} />
          <OptionCard title="Proportions (pass/fail rates)" desc="Test an observed proportion, or compare two." selected={a.planGoal === 'proportion'} onClick={() => set({ planGoal: 'proportion' })} />
          <OptionCard title="What-if & validation" desc="Expected failures, simulation, detectability, goodness of fit." selected={a.planGoal === 'whatif'} onClick={() => set({ planGoal: 'whatif' })} />
        </>
      )}

      {step === 'propkind' && (
        <>
          <p className="text-xs text-gray-600 mb-1">One proportion or two?</p>
          <OptionCard title="One proportion vs a target" desc="Does the observed pass rate meet the requirement?" selected={a.propKind === 'one'} onClick={() => set({ propKind: 'one' })} />
          <OptionCard title="Compare two proportions" desc="Design A vs design B, old vs new supplier." selected={a.propKind === 'two'} onClick={() => set({ propKind: 'two' })} />
        </>
      )}

      {step === 'whatif' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Which question?</p>
          <OptionCard title="When will failures occur?" desc="Expected failure times during the planned test." selected={a.whatIf === 'expected'} onClick={() => set({ whatIf: 'expected' })} />
          <OptionCard title="Simulate the plan" desc="Monte-Carlo the test outcome distribution before committing hardware." selected={a.whatIf === 'simulation'} onClick={() => set({ whatIf: 'simulation' })} />
          <OptionCard title="Can I tell two designs apart?" desc="Test time needed for a real difference to become detectable." selected={a.whatIf === 'difference'} onClick={() => set({ whatIf: 'difference' })} />
          <OptionCard title="Validate a distribution" desc="Goodness-of-fit check on existing failure data." selected={a.whatIf === 'gof'} onClick={() => set({ whatIf: 'gof' })} />
        </>
      )}

      {step === 'screen' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Where in the lifecycle?</p>
          <OptionCard title="Development: find design limits" desc="HALT — step stress to discover operating/destruct margins." selected={a.screen === 'limits'} onClick={() => set({ screen: 'limits' })} />
          <OptionCard title="Production: classical ESS" desc="Thermal/vibration screen applied to every unit." selected={a.screen === 'ess'} onClick={() => set({ screen: 'ess' })} />
          <OptionCard title="Production: HASS (post-HALT)" desc="Aggressive screen inside the HALT-proven limits." selected={a.screen === 'hass'} onClick={() => set({ screen: 'hass' })} />
          <OptionCard title="Burn-in economics" desc="Size a burn-in against infant mortality and warranty cost." selected={a.screen === 'burnin'} onClick={() => set({ screen: 'burnin' })} />
        </>
      )}

      {step === 'rec' && rec && (
        <RecommendationCard rec={rec} footNote="Applying opens the tool — enter your inputs there and run." />
      )}
    </WizardShell>
  )
}
