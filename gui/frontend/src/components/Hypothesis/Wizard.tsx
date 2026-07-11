/**
 * Hypothesis-test picker — guides the user from "what am I comparing?" to a
 * concrete test (with assumptions spelled out), then selects that test in the
 * sidebar. Pure decision logic + shared WizardShell chrome.
 */
import { useState } from 'react'
import WizardShell, { OptionCard, RecommendationCard, RecInfo } from '../shared/WizardShell'

export interface TestRecommendation extends RecInfo {
  testKey: string
}

type Compare = 'one' | 'two' | 'many' | 'counts'
type Dist = 'normal' | 'nonnormal'
type Design = 'independent' | 'factorial' | 'repeated' | 'mixed'
type Counts = 'prop' | 'gof' | 'table'

interface Answers {
  compare: Compare | null
  paired: 'yes' | 'no'
  dist: Dist
  design: Design
  counts: Counts
}

const INITIAL: Answers = { compare: null, paired: 'no', dist: 'normal', design: 'independent', counts: 'prop' }

// ---------------------------------------------------------------------------
// Decision engine
// ---------------------------------------------------------------------------

const NORMALITY_CAUTION =
  'Check the assumption: t-tests/ANOVA are robust to mild non-normality once n ≳ 30 per group, but sensitive with small skewed samples or outliers.'

export function recommend(a: Answers): TestRecommendation | null {
  if (a.compare === null) return null

  if (a.compare === 'one') {
    return {
      testKey: 'one_sample_t',
      title: 'One-sample t-test',
      detail: 'Inputs: sample values + hypothesized mean μ₀',
      rationale: 'You are testing whether one sample\'s mean differs from a known/target value — the one-sample t-test is the standard approach, using the sample\'s own variability to judge the difference.',
      cautions: a.dist === 'nonnormal'
        ? ['With small, clearly non-normal samples the t-test\'s p-value is unreliable. This app has no one-sample nonparametric test — consider transforming the data, collecting more observations, or interpreting the result cautiously.']
        : [NORMALITY_CAUTION],
      alternatives: [],
    }
  }

  if (a.compare === 'two') {
    if (a.paired === 'yes') {
      return a.dist === 'normal'
        ? {
            testKey: 'paired_t',
            title: 'Paired t-test',
            detail: 'Inputs: two equal-length columns of matched measurements',
            rationale: 'Matched observations (before/after, same unit measured twice) share unit-to-unit variation. The paired t-test analyzes the within-pair differences, removing that shared variation for much higher power than an unpaired test.',
            cautions: ['The normality assumption applies to the pair differences, not the raw values.'],
            alternatives: [{ label: 'Wilcoxon Signed-Rank', note: 'If the differences are clearly non-normal.' }],
          }
        : {
            testKey: 'wilcoxon_signed_rank',
            title: 'Wilcoxon Signed-Rank test',
            detail: 'Inputs: two equal-length columns of matched measurements',
            rationale: 'The nonparametric counterpart of the paired t-test: it ranks the within-pair differences, so no normality assumption is needed — right for small or skewed paired samples.',
            cautions: ['Assumes the difference distribution is roughly symmetric about its median.'],
            alternatives: [{ label: 'Paired t-test', note: 'More powerful if differences are approximately normal.' }],
          }
    }
    return a.dist === 'normal'
      ? {
          testKey: 'two_sample_t',
          title: 'Two-sample t-test (Welch)',
          detail: 'Inputs: two independent groups of values',
          rationale: 'Comparing the means of two independent groups is the classic two-sample t-test. The Welch variant (default here) does not assume equal variances, which is the safer modern default.',
          cautions: [NORMALITY_CAUTION, 'Leave "equal variances" unchecked unless you have a specific reason — Welch loses almost nothing when variances happen to be equal.'],
          alternatives: [{ label: 'Mann-Whitney U', note: 'If either group is small and clearly non-normal.' }],
        }
      : {
          testKey: 'mann_whitney',
          title: 'Mann-Whitney U test',
          detail: 'Inputs: two independent groups of values',
          rationale: 'The rank-based counterpart of the two-sample t-test: it tests for a location shift between two independent groups without assuming normality — appropriate for small, skewed, or ordinal data.',
          cautions: ['Interprets cleanly as a median/location shift only when the two distributions have similar shape.'],
          alternatives: [{ label: 'Two-sample t-test (Welch)', note: 'More powerful when both groups are roughly normal or large.' }],
        }
  }

  if (a.compare === 'many') {
    switch (a.design) {
      case 'independent':
        return a.dist === 'normal'
          ? {
              testKey: 'one_way_anova',
              title: 'One-Way ANOVA',
              detail: 'Inputs: one row of values per group (≥2 groups)',
              rationale: 'Comparing means across three or more independent groups with one factor is one-way ANOVA. It controls the overall Type-I error (running repeated t-tests would inflate it), and Tukey HSD then identifies which groups differ.',
              cautions: [NORMALITY_CAUTION, 'Also assumes similar variances across groups; with very unequal spreads consider Kruskal-Wallis.'],
              alternatives: [{ label: 'Kruskal-Wallis H', note: 'Rank-based; drops the normality assumption.' }],
            }
          : {
              testKey: 'kruskal_wallis',
              title: 'Kruskal-Wallis H test',
              detail: 'Inputs: one row of values per group (≥3 groups)',
              rationale: 'The rank-based extension of Mann-Whitney to three or more independent groups — tests whether at least one group\'s distribution is shifted, without assuming normality.',
              cautions: ['A significant result says "some group differs"; follow up with pairwise Mann-Whitney tests (with a multiplicity correction) to find which.'],
              alternatives: [{ label: 'One-Way ANOVA', note: 'More powerful when groups are roughly normal with similar variances.' }],
            }
      case 'factorial':
        return {
          testKey: 'factorial_anova',
          title: 'Factorial ANOVA (1–3 way)',
          detail: 'Inputs: CSV table with a response column + 1–3 factor columns',
          rationale: 'With two or three crossed factors, factorial ANOVA estimates each factor\'s main effect AND their interactions from the same data — far more informative than testing one factor at a time.',
          cautions: ['Aim for a balanced design (equal replicates per cell); heavily unbalanced data makes the sums-of-squares decomposition ambiguous.', NORMALITY_CAUTION],
          alternatives: [],
        }
      case 'repeated':
        return a.dist === 'normal'
          ? {
              testKey: 'rm_anova',
              title: 'Repeated-Measures ANOVA',
              detail: 'Inputs: subjects × conditions matrix (one row per subject)',
              rationale: 'The same subjects measured under every condition share subject-level variation; repeated-measures ANOVA removes it, giving much higher power than treating the conditions as independent groups.',
              cautions: ['Perdura reports Mauchly’s diagnostic and GG/HF corrections; review the selected correction and residual-profile assumptions.'],
              alternatives: [{ label: 'Friedman Test', note: 'Rank-based repeated-measures alternative, no normality/sphericity assumptions.' }],
            }
          : {
              testKey: 'friedman',
              title: 'Friedman test',
              detail: 'Inputs: subjects × conditions matrix (one row per subject)',
              rationale: 'The nonparametric repeated-measures ANOVA: ranks each subject\'s values across conditions, so neither normality nor sphericity is required.',
              cautions: ['Less powerful than RM-ANOVA when its assumptions actually hold.'],
              alternatives: [{ label: 'Repeated-Measures ANOVA', note: 'If the data are roughly normal.' }],
            }
      case 'mixed':
        return {
          testKey: 'mixed_anova',
          title: 'Mixed ANOVA',
          detail: 'Inputs: long-format table (value, subject, between-factor, within-factor)',
          rationale: 'One factor varies between subjects (e.g. treatment group) while another varies within subjects (e.g. time) — the mixed ANOVA estimates both effects and, critically, their interaction (does the change over time differ by group?).',
          cautions: ['Requires complete data per subject, independent subjects, approximately multivariate-normal residual profiles, and a common within-subject covariance across groups.'],
          alternatives: [],
        }
    }
  }

  // counts
  switch (a.counts) {
    case 'prop':
      return {
        testKey: 'binomial_test',
        title: 'Binomial test (exact)',
        detail: 'Inputs: number of successes, trials n, hypothesized p₀',
        rationale: 'Testing one observed proportion against a target value calls for the exact binomial test — valid at any sample size, with no large-sample approximation.',
        cautions: [],
        alternatives: [],
      }
    case 'gof':
      return {
        testKey: 'chi_square_gof',
        title: 'Chi-Square Goodness-of-Fit',
        detail: 'Inputs: observed counts per category (+ optional expected counts)',
        rationale: 'Comparing observed category counts against an expected distribution (uniform or specified) is the chi-square goodness-of-fit test.',
        cautions: ['Expected counts should be ≥ 5 in (nearly) every category for the χ² approximation to hold — merge sparse categories if needed.'],
        alternatives: [],
      }
    case 'table':
      return {
        testKey: 'chi_square_independence',
        title: 'Chi-Square test of Independence',
        detail: 'Inputs: contingency table (rows × columns of counts)',
        rationale: 'Testing whether two categorical variables are associated (e.g. supplier vs defect type) uses the chi-square independence test on the contingency table; Cramér\'s V reports the strength of association.',
        cautions: ['Expected cell counts should be ≥ 5; for small 2×2 tables an exact test is preferable — interpret borderline p-values carefully.'],
        alternatives: [],
      }
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type StepId = 'compare' | 'paired' | 'design' | 'dist' | 'counts' | 'rec'

function stepsFor(a: Answers): StepId[] {
  switch (a.compare) {
    case 'one': return ['compare', 'dist', 'rec']
    case 'two': return ['compare', 'paired', 'dist', 'rec']
    case 'many': return (a.design === 'factorial' || a.design === 'mixed')
      ? ['compare', 'design', 'rec']
      : ['compare', 'design', 'dist', 'rec']
    case 'counts': return ['compare', 'counts', 'rec']
    default: return ['compare']
  }
}

export default function HypothesisWizard({ open, onClose, onApply }: {
  open: boolean
  onClose: () => void
  onApply: (testKey: string) => void
}) {
  const [a, setA] = useState<Answers>(INITIAL)
  const [stepIdx, setStepIdx] = useState(0)
  if (!open) return null

  const set = (p: Partial<Answers>) => setA(prev => ({ ...prev, ...p }))
  const steps = stepsFor(a)
  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const rec = step === 'rec' ? recommend(a) : null
  const canNext = step !== 'compare' || a.compare !== null

  return (
    <WizardShell
      open={open}
      onClose={onClose}
      title="Test wizard"
      stepCount={steps.length}
      stepIdx={stepIdx}
      isFinal={step === 'rec'}
      canNext={canNext}
      onBack={() => setStepIdx(i => i - 1)}
      onNext={() => canNext && setStepIdx(i => i + 1)}
      onRestart={() => { setA(INITIAL); setStepIdx(0) }}
      onApply={() => rec && onApply(rec.testKey)}
      applyLabel="Select this test"
    >
      {step === 'compare' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What are you comparing?</p>
          <OptionCard title="One sample vs a known value" desc="Does my sample's mean differ from a target/specified value?" selected={a.compare === 'one'} onClick={() => set({ compare: 'one' })} />
          <OptionCard title="Two groups" desc="Do two sets of measurements differ (treatment vs control, before vs after)?" selected={a.compare === 'two'} onClick={() => set({ compare: 'two' })} />
          <OptionCard title="Three or more groups / factors" desc="Compare several groups, or study one or more factors at several levels." selected={a.compare === 'many'} onClick={() => set({ compare: 'many' })} />
          <OptionCard title="Counts or proportions" desc="Pass/fail rates, defect categories, contingency tables — categorical data." selected={a.compare === 'counts'} onClick={() => set({ compare: 'counts' })} />
        </>
      )}

      {step === 'paired' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Are the two groups paired (matched)?</p>
          <OptionCard title="Independent groups" desc="Different units in each group — e.g. parts from line A vs line B." selected={a.paired === 'no'} onClick={() => set({ paired: 'no' })} />
          <OptionCard title="Paired / matched" desc="The SAME units measured twice — before/after, two instruments on one part." selected={a.paired === 'yes'} onClick={() => set({ paired: 'yes' })} />
        </>
      )}

      {step === 'design' && (
        <>
          <p className="text-xs text-gray-600 mb-1">How is the experiment structured?</p>
          <OptionCard title="Independent groups, one factor" desc="Each unit belongs to exactly one group (e.g. 4 suppliers)." selected={a.design === 'independent'} onClick={() => set({ design: 'independent' })} />
          <OptionCard title="Two or three crossed factors" desc="Every combination of factor levels is tested (e.g. temperature × humidity)." selected={a.design === 'factorial'} onClick={() => set({ design: 'factorial' })} />
          <OptionCard title="Repeated measures" desc="The same subjects/units measured under every condition." selected={a.design === 'repeated'} onClick={() => set({ design: 'repeated' })} />
          <OptionCard title="Mixed (between + within)" desc="Groups of subjects, each measured repeatedly (e.g. treatment group × time)." selected={a.design === 'mixed'} onClick={() => set({ design: 'mixed' })} />
        </>
      )}

      {step === 'dist' && (
        <>
          <p className="text-xs text-gray-600 mb-1">
            {a.compare === 'two' && a.paired === 'yes'
              ? 'Are the within-pair differences roughly normal (or do you have ~30+ pairs)?'
              : 'Are the data roughly normal (or each group reasonably large, n ≳ 30)?'}
          </p>
          <OptionCard title="Yes — roughly normal or large samples" desc="Histogram is bell-ish, no extreme outliers, or the sample is big enough for the CLT." selected={a.dist === 'normal'} onClick={() => set({ dist: 'normal' })} />
          <OptionCard title="No — small, skewed, or outlier-prone" desc="Few observations with clear skew/outliers, or ordinal (ranked) data." selected={a.dist === 'nonnormal'} onClick={() => set({ dist: 'nonnormal' })} />
        </>
      )}

      {step === 'counts' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What kind of categorical question?</p>
          <OptionCard title="One proportion vs a target" desc="e.g. Is the defect rate different from 2%? (successes / trials / p₀)" selected={a.counts === 'prop'} onClick={() => set({ counts: 'prop' })} />
          <OptionCard title="Category counts vs expected" desc="Do observed frequencies match an expected distribution across categories?" selected={a.counts === 'gof'} onClick={() => set({ counts: 'gof' })} />
          <OptionCard title="Two categorical variables" desc="Are rows and columns of a count table associated (e.g. shift vs defect type)?" selected={a.counts === 'table'} onClick={() => set({ counts: 'table' })} />
        </>
      )}

      {step === 'rec' && rec && (
        <RecommendationCard
          rec={rec}
          footNote="Applying selects this test in the sidebar — fill in its inputs and click Run."
        />
      )}
    </WizardShell>
  )
}
