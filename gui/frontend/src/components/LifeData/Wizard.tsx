/**
 * Life-data analysis wizard — guides the choice of analysis mode (parametric /
 * nonparametric / special models / Weibayes / stress-strength) and estimation
 * method (MLE vs rank regression, KM vs NA) from the data situation. Applies by
 * patching the active folio's mode fields.
 */
import { useState } from 'react'
import WizardShell, { OptionCard, RecommendationCard, RecInfo } from '../shared/WizardShell'

/** Folio fields the wizard may set (subset of LifeData's Folio). */
export interface LifeDataPatch {
  analysisMode: 'parametric' | 'nonparametric' | 'special' | 'weibayes' | 'cfm' | 'stressstrength'
  method?: 'MLE' | 'RRX' | 'RRY'
  npMethod?: 'KM' | 'NA'
  specialModel?: string
}

export interface ModeRecommendation extends RecInfo {
  patch: LifeDataPatch
}

type Failures = 'none' | 'some'
type Situation = 'standard' | 'noassume' | 'hetero' | 'ss'
type Censoring = 'censored' | 'complete_small' | 'complete_large'
type NpFocus = 'survival' | 'hazard'
type Hetero = 'mixture' | 'competing' | 'defective'
type Defective = 'never' | 'doa' | 'both'

interface Answers {
  failures: Failures | null
  situation: Situation
  censoring: Censoring
  npFocus: NpFocus
  hetero: Hetero
  defective: Defective
}

const INITIAL: Answers = {
  failures: null, situation: 'standard', censoring: 'censored',
  npFocus: 'survival', hetero: 'mixture', defective: 'never',
}

export function recommend(a: Answers): ModeRecommendation | null {
  if (a.failures === null) return null

  if (a.failures === 'none') {
    return {
      title: 'Weibayes (zero-failure analysis)',
      detail: 'Inputs: run times/suspensions + an assumed Weibull β',
      rationale: 'With no failures there is nothing to fit — but assuming a shape parameter β from experience with the failure mode lets Weibayes place a lower confidence bound on the characteristic life from the accumulated (suspension) time alone.',
      cautions: ['The result is only as good as the assumed β — take it from prior tests of the SAME failure mode, and check sensitivity by trying a range of β values.'],
      alternatives: [{ label: 'RDT tools (Reliability Testing module)', note: 'To demonstrate a reliability target from a zero-failure test.' }],
      patch: { analysisMode: 'weibayes' },
    }
  }

  switch (a.situation) {
    case 'noassume':
      return a.npFocus === 'survival'
        ? {
            title: 'Nonparametric — Kaplan-Meier',
            detail: 'Estimates the survival function directly from the data',
            rationale: 'Kaplan-Meier makes no distributional assumption: it steps the survival estimate down at each failure while correctly handling right-censored units — the standard first look, and the honest answer when no parametric model is defensible.',
            cautions: ['No extrapolation beyond the last observation — parametric fits are needed to predict outside the observed range.'],
            alternatives: [{ label: 'Nelson-Aalen', note: 'If the cumulative hazard (failure-rate behavior) is the quantity of interest.' }],
            patch: { analysisMode: 'nonparametric', npMethod: 'KM' },
          }
        : {
            title: 'Nonparametric — Nelson-Aalen',
            detail: 'Estimates the cumulative hazard function directly',
            rationale: 'Nelson-Aalen estimates the cumulative hazard, whose slope reveals whether the failure rate is rising, constant, or falling — often the most diagnostic nonparametric view for maintenance decisions.',
            cautions: ['Like all nonparametric estimates, it cannot extrapolate beyond the data.'],
            alternatives: [{ label: 'Kaplan-Meier', note: 'If survival probability is the primary output.' }],
            patch: { analysisMode: 'nonparametric', npMethod: 'NA' },
          }
    case 'hetero':
      switch (a.hetero) {
        case 'mixture':
          return {
            title: 'Special model — Weibull Mixture',
            detail: 'Fits two (or more) Weibull subpopulations with mixing proportions',
            rationale: 'A dogleg or S-bend in the probability plot usually means two subpopulations (e.g. a weak early-failure batch plus the main population). The mixture model fits each subpopulation and its proportion explicitly instead of forcing one compromised distribution.',
            cautions: ['Mixtures need a healthy number of failures (roughly 20+) to identify the subpopulations reliably.'],
            alternatives: [{ label: 'Competing Risks', note: 'If every unit is exposed to several failure MODES instead.' }],
            patch: { analysisMode: 'special', specialModel: 'mixture' },
          }
        case 'competing':
          return {
            title: 'Special model — Competing Risks',
            detail: 'Fits independent failure modes acting on every unit',
            rationale: 'When every unit is simultaneously exposed to multiple independent failure modes (wear-out AND overstress, say), the observed life is the minimum of the mode lives. The competing-risks model fits the modes jointly — the correct structure, unlike a single pooled fit.',
            cautions: ['If failure modes are identifiable per unit, the CFM mode (fit each mode separately, treating others as suspensions) is even more informative.'],
            alternatives: [{ label: 'CFM (competing failure modes)', note: 'When each failure\'s mode is recorded.' }],
            patch: { analysisMode: 'special', specialModel: 'competing_risks' },
          }
        case 'defective':
          if (a.defective === 'never') {
            return {
              title: 'Special model — Defective Subpopulation (DS)',
              detail: 'Fits a fraction that can fail + a fraction that never will',
              rationale: 'When only part of the population is susceptible (a defective fraction) and the rest will never exhibit this failure mode, the DS model estimates both the defective proportion and the life distribution of the susceptible units.',
              cautions: ['Needs enough test time that the plateau (non-susceptible fraction) is actually visible in the data.'],
              alternatives: [],
              patch: { analysisMode: 'special', specialModel: 'ds' },
            }
          }
          if (a.defective === 'doa') {
            return {
              title: 'Special model — Zero-Inflated (ZI)',
              detail: 'Fits a dead-on-arrival fraction + a life distribution for the rest',
              rationale: 'A spike of failures at time zero (dead-on-arrival units) violates every standard life distribution. The ZI model estimates the DOA proportion separately, then fits the survivors\' life distribution cleanly.',
              cautions: [],
              alternatives: [],
              patch: { analysisMode: 'special', specialModel: 'zi' },
            }
          }
          return {
            title: 'Special model — DS + Zero-Inflated (DSZI)',
            detail: 'Combines a DOA fraction, a susceptible fraction, and a never-fail fraction',
            rationale: 'The DSZI model handles both anomalies at once: some units dead on arrival, some susceptible to failure in time, and some that will never fail from this mode.',
            cautions: ['The most heavily parameterized special model — needs substantial data to identify all fractions.'],
            alternatives: [],
            patch: { analysisMode: 'special', specialModel: 'dszi' },
          }
      }
      break
    case 'ss':
      return {
        title: 'Stress–Strength interference',
        detail: 'Compares a stress distribution against a strength distribution',
        rationale: 'When failure occurs where the applied-stress distribution overlaps the strength distribution, reliability is P(strength > stress). Fit both distributions (each from its own analysis) and the S-S analysis integrates their interference.',
        cautions: ['Fit the stress and strength analyses first; the S-S view combines existing fits.'],
        alternatives: [],
        patch: { analysisMode: 'stressstrength' },
      }
    case 'standard':
      break
  }

  // standard parametric fit
  if (a.censoring === 'censored') {
    return {
      title: 'Parametric fit — MLE',
      detail: 'Maximum likelihood over all candidate distributions, ranked by AICc',
      rationale: 'With censored data (suspensions), maximum likelihood is the method of choice: it uses the exact information in every censored unit, where rank-regression methods only approximate it. The module fits all selected distributions and ranks them by AICc.',
      cautions: ['MLE\'s Weibull β is biased high in very small samples (n ≲ 10) — interpret cautiously or compare against RRX.'],
      alternatives: [{ label: 'RRX', note: 'For visual agreement with the probability plot on small complete samples.' }],
      patch: { analysisMode: 'parametric', method: 'MLE' },
    }
  }
  if (a.censoring === 'complete_small') {
    return {
      title: 'Parametric fit — Rank Regression (RRX)',
      detail: 'Least-squares fit through the probability-plot points',
      rationale: 'On small, complete (uncensored) samples, rank regression on X follows the traditional probability-plotting practice and matches what the eye sees on the plot; its small-sample bias behavior is also gentler than MLE\'s for the Weibull shape parameter.',
      cautions: ['Switch to MLE the moment suspensions enter the dataset — RRX handles censoring poorly.'],
      alternatives: [{ label: 'MLE', note: 'Statistically efficient and the default for anything censored or larger.' }],
      patch: { analysisMode: 'parametric', method: 'RRX' },
    }
  }
  return {
    title: 'Parametric fit — MLE',
    detail: 'Maximum likelihood over all candidate distributions, ranked by AICc',
    rationale: 'For complete datasets of reasonable size, MLE is asymptotically the most efficient estimator and yields clean likelihood-based confidence bounds. The module fits all selected distributions and ranks them by AICc.',
    cautions: [],
    alternatives: [{ label: 'RRX', note: 'Matches classical probability-plotting if you need to reproduce legacy results.' }],
    patch: { analysisMode: 'parametric', method: 'MLE' },
  }
}

type StepId = 'failures' | 'situation' | 'censoring' | 'npfocus' | 'hetero' | 'defective' | 'rec'

function stepsFor(a: Answers): StepId[] {
  if (a.failures === null) return ['failures']
  if (a.failures === 'none') return ['failures', 'rec']
  switch (a.situation) {
    case 'noassume': return ['failures', 'situation', 'npfocus', 'rec']
    case 'hetero': return a.hetero === 'defective'
      ? ['failures', 'situation', 'hetero', 'defective', 'rec']
      : ['failures', 'situation', 'hetero', 'rec']
    case 'ss': return ['failures', 'situation', 'rec']
    default: return ['failures', 'situation', 'censoring', 'rec']
  }
}

export default function LifeDataWizard({ open, onClose, onApply }: {
  open: boolean
  onClose: () => void
  onApply: (patch: LifeDataPatch) => void
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
      title="Analysis wizard"
      stepCount={steps.length}
      stepIdx={stepIdx}
      isFinal={step === 'rec'}
      canNext={step !== 'failures' || a.failures !== null}
      onBack={() => setStepIdx(i => i - 1)}
      onNext={() => setStepIdx(i => i + 1)}
      onRestart={() => { setA(INITIAL); setStepIdx(0) }}
      onApply={() => rec && onApply(rec.patch)}
      applyLabel="Use this analysis"
    >
      {step === 'failures' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Did the test produce any failures?</p>
          <OptionCard title="Yes — at least a few failures" desc="Failure times were observed (possibly alongside suspensions)." selected={a.failures === 'some'} onClick={() => set({ failures: 'some' })} />
          <OptionCard title="No — zero failures" desc="Everything survived; only accumulated run time is available." selected={a.failures === 'none'} onClick={() => set({ failures: 'none' })} />
        </>
      )}

      {step === 'situation' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Which best describes the analysis you need?</p>
          <OptionCard title="Fit a life distribution" desc="Standard reliability analysis — B10 life, reliability at time t, confidence bounds." selected={a.situation === 'standard'} onClick={() => set({ situation: 'standard' })} />
          <OptionCard title="No distribution assumption" desc="Estimate survival/hazard directly from the data (Kaplan-Meier / Nelson-Aalen)." selected={a.situation === 'noassume'} onClick={() => set({ situation: 'noassume' })} />
          <OptionCard title="Population isn't homogeneous" desc="Doglegged probability plot, several failure modes, or a defective subpopulation." selected={a.situation === 'hetero'} onClick={() => set({ situation: 'hetero' })} />
          <OptionCard title="Stress vs strength" desc="Reliability from the overlap of a stress distribution and a strength distribution." selected={a.situation === 'ss'} onClick={() => set({ situation: 'ss' })} />
        </>
      )}

      {step === 'censoring' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What does the dataset look like?</p>
          <OptionCard title="Censored (has suspensions)" desc="Some units were removed or still running when the test ended." selected={a.censoring === 'censored'} onClick={() => set({ censoring: 'censored' })} />
          <OptionCard title="Complete, small (n ≲ 15)" desc="Every unit failed; only a handful of data points." selected={a.censoring === 'complete_small'} onClick={() => set({ censoring: 'complete_small' })} />
          <OptionCard title="Complete, larger" desc="Every unit failed; a reasonable sample size." selected={a.censoring === 'complete_large'} onClick={() => set({ censoring: 'complete_large' })} />
        </>
      )}

      {step === 'npfocus' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Which quantity matters most?</p>
          <OptionCard title="Survival probability" desc="R(t): the chance a unit survives to time t (Kaplan-Meier)." selected={a.npFocus === 'survival'} onClick={() => set({ npFocus: 'survival' })} />
          <OptionCard title="Failure-rate behavior" desc="Cumulative hazard: is the failure rate rising, constant, or falling? (Nelson-Aalen)" selected={a.npFocus === 'hazard'} onClick={() => set({ npFocus: 'hazard' })} />
        </>
      )}

      {step === 'hetero' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What kind of heterogeneity?</p>
          <OptionCard title="Two subpopulations" desc="A dogleg/S-bend in the probability plot — e.g. a weak batch plus the main population." selected={a.hetero === 'mixture'} onClick={() => set({ hetero: 'mixture' })} />
          <OptionCard title="Multiple failure modes" desc="Every unit is exposed to several independent ways of failing." selected={a.hetero === 'competing'} onClick={() => set({ hetero: 'competing' })} />
          <OptionCard title="A defective fraction" desc="Only part of the population is susceptible, or some units fail immediately." selected={a.hetero === 'defective'} onClick={() => set({ hetero: 'defective' })} />
        </>
      )}

      {step === 'defective' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Which pattern fits the defective fraction?</p>
          <OptionCard title="Some units will NEVER fail" desc="The failure curve plateaus below 100% — only a susceptible fraction fails (DS)." selected={a.defective === 'never'} onClick={() => set({ defective: 'never' })} />
          <OptionCard title="Some units fail immediately" desc="A spike of dead-on-arrival failures at time zero (ZI)." selected={a.defective === 'doa'} onClick={() => set({ defective: 'doa' })} />
          <OptionCard title="Both patterns" desc="DOA units AND a never-fail fraction (DSZI)." selected={a.defective === 'both'} onClick={() => set({ defective: 'both' })} />
        </>
      )}

      {step === 'rec' && rec && (
        <RecommendationCard rec={rec} footNote="Applying switches the active analysis mode — enter data and click Calculate." />
      )}
    </WizardShell>
  )
}
