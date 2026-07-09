/**
 * SPC chart picker — the classic control-chart selection flowchart
 * (variables vs attributes → subgroup size / count type / sample-size
 * constancy) as a short guided Q&A. Applies by setting the chart type.
 */
import { useState } from 'react'
import WizardShell, { OptionCard, RecommendationCard, RecInfo } from '../shared/WizardShell'
import type { ChartType } from '../../api/spc'

export interface ChartRecommendation extends RecInfo {
  chart: ChartType
}

type Kind = 'measured' | 'attribute' | null
type SubSize = '1' | 'small' | 'large'
type AttrKind = 'defectives' | 'defects'
type Constant = 'yes' | 'no'

interface Answers {
  kind: Kind
  subSize: SubSize
  attrKind: AttrKind
  constant: Constant
}

const INITIAL: Answers = { kind: null, subSize: '1', attrKind: 'defectives', constant: 'yes' }

export function recommend(a: Answers): ChartRecommendation | null {
  if (a.kind === null) return null

  if (a.kind === 'measured') {
    if (a.subSize === '1') {
      return {
        chart: 'i_mr',
        title: 'I-MR chart (Individuals & Moving Range)',
        detail: 'One measured value per row',
        rationale: 'With no rational subgroups (one measurement per time point — slow processes, batch chemistry, destructive tests), the I-MR pair tracks the individual values and their point-to-point variation.',
        cautions: ['Individuals charts are more sensitive to non-normality than X̄ charts — check the distribution if signals look odd.'],
        alternatives: [{ label: 'X̄-R', note: 'If you can group 2–9 consecutive measurements into rational subgroups (more power).' }],
      }
    }
    if (a.subSize === 'small') {
      return {
        chart: 'xbar_r',
        title: 'X̄-R chart (subgroup mean & range)',
        detail: 'Each subgroup entered across the columns of a row',
        rationale: 'For rational subgroups of 2–9 measurements, the range is an efficient, simple estimate of within-subgroup spread — the classic X̄-R pairing tracks both process centering and variation.',
        cautions: ['Form subgroups so that only common-cause variation occurs WITHIN them (e.g. consecutive parts) — special causes should appear BETWEEN subgroups.'],
        alternatives: [{ label: 'X̄-S', note: 'Slightly more efficient; preferred as subgroups grow.' }],
      }
    }
    return {
      chart: 'xbar_s',
      title: 'X̄-S chart (subgroup mean & standard deviation)',
      detail: 'Each subgroup entered across the columns of a row',
      rationale: 'For subgroups of about 10 or more, the standard deviation uses all the data in each subgroup and clearly outperforms the range as a spread estimate — X̄-S is the standard choice.',
      cautions: [],
      alternatives: [{ label: 'X̄-R', note: 'Fine for smaller subgroups (2–9).' }],
    }
  }

  // attribute data
  if (a.attrKind === 'defectives') {
    return a.constant === 'yes'
      ? {
          chart: 'np',
          title: 'np chart (number of defective units)',
          detail: 'Count of defective units per constant-size sample',
          rationale: 'Classifying whole units as pass/fail with a constant sample size lets you plot the raw defective COUNT — the np chart, based on the binomial distribution, is the simplest correct choice.',
          cautions: [],
          alternatives: [{ label: 'p chart', note: 'Equivalent; use if the sample size might vary later.' }],
        }
      : {
          chart: 'p',
          title: 'p chart (fraction defective)',
          detail: 'Defective count + sample size per row (size may vary)',
          rationale: 'With varying sample sizes, the FRACTION defective is comparable across samples where the raw count is not — the p chart adjusts its control limits per sample size.',
          cautions: ['Very small samples make the limits wide and the chart insensitive; aim for n·p ≥ ~5 per sample.'],
          alternatives: [],
        }
  }
  return a.constant === 'yes'
    ? {
        chart: 'c',
        title: 'c chart (defect count per unit)',
        detail: 'One defect count per row (constant inspection amount)',
        rationale: 'Counting DEFECTS (a unit can have several) over a constant inspection amount follows a Poisson distribution — the c chart plots the raw counts with Poisson-based limits.',
        cautions: [],
        alternatives: [{ label: 'u chart', note: 'If the inspection amount might vary.' }],
      }
    : {
        chart: 'u',
        title: 'u chart (defects per unit)',
        detail: 'Defect count + inspection size per row (size may vary)',
        rationale: 'When the amount inspected varies (different areas, lengths, batch sizes), defects must be normalized PER UNIT — the u chart adjusts its limits for each sample\'s inspection size.',
        cautions: [],
        alternatives: [],
      }
}

type StepId = 'kind' | 'subsize' | 'attrkind' | 'constant' | 'rec'

function stepsFor(kind: Kind): StepId[] {
  if (kind === 'measured') return ['kind', 'subsize', 'rec']
  if (kind === 'attribute') return ['kind', 'attrkind', 'constant', 'rec']
  return ['kind']
}

export default function SPCWizard({ open, onClose, onApply }: {
  open: boolean
  onClose: () => void
  onApply: (chart: ChartType) => void
}) {
  const [a, setA] = useState<Answers>(INITIAL)
  const [stepIdx, setStepIdx] = useState(0)
  if (!open) return null

  const set = (p: Partial<Answers>) => setA(prev => ({ ...prev, ...p }))
  const steps = stepsFor(a.kind)
  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const rec = step === 'rec' ? recommend(a) : null

  return (
    <WizardShell
      open={open}
      onClose={onClose}
      title="Chart wizard"
      stepCount={steps.length}
      stepIdx={stepIdx}
      isFinal={step === 'rec'}
      canNext={step !== 'kind' || a.kind !== null}
      onBack={() => setStepIdx(i => i - 1)}
      onNext={() => setStepIdx(i => i + 1)}
      onRestart={() => { setA(INITIAL); setStepIdx(0) }}
      onApply={() => rec && onApply(rec.chart)}
      applyLabel="Use this chart"
    >
      {step === 'kind' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What kind of data are you charting?</p>
          <OptionCard title="Measured values (variables)" desc="Continuous measurements — dimensions, weights, temperatures, times." selected={a.kind === 'measured'} onClick={() => set({ kind: 'measured' })} />
          <OptionCard title="Counted defects (attributes)" desc="Pass/fail classifications or defect counts from inspection." selected={a.kind === 'attribute'} onClick={() => set({ kind: 'attribute' })} />
        </>
      )}

      {step === 'subsize' && (
        <>
          <p className="text-xs text-gray-600 mb-1">How many measurements per sampling point (rational subgroup)?</p>
          <OptionCard title="One at a time" desc="A single measurement per time point — no natural subgroups." selected={a.subSize === '1'} onClick={() => set({ subSize: '1' })} />
          <OptionCard title="Small subgroups (2–9)" desc="A handful of consecutive measurements taken together." selected={a.subSize === 'small'} onClick={() => set({ subSize: 'small' })} />
          <OptionCard title="Large subgroups (10+)" desc="Ten or more measurements per subgroup." selected={a.subSize === 'large'} onClick={() => set({ subSize: 'large' })} />
        </>
      )}

      {step === 'attrkind' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What are you counting?</p>
          <OptionCard title="Defective UNITS" desc="Each unit is judged pass/fail as a whole (binomial)." selected={a.attrKind === 'defectives'} onClick={() => set({ attrKind: 'defectives' })} />
          <OptionCard title="DEFECTS per unit" desc="A unit can carry multiple defects — scratches, voids, solder faults (Poisson)." selected={a.attrKind === 'defects'} onClick={() => set({ attrKind: 'defects' })} />
        </>
      )}

      {step === 'constant' && (
        <>
          <p className="text-xs text-gray-600 mb-1">
            Is the {a.attrKind === 'defectives' ? 'sample size' : 'amount inspected'} the same every time?
          </p>
          <OptionCard title="Yes — constant" desc="Same number of units / same inspection area each sample." selected={a.constant === 'yes'} onClick={() => set({ constant: 'yes' })} />
          <OptionCard title="No — it varies" desc="Sample size or inspection amount changes between samples." selected={a.constant === 'no'} onClick={() => set({ constant: 'no' })} />
        </>
      )}

      {step === 'rec' && rec && (
        <RecommendationCard rec={rec} footNote="Applying selects the chart type — enter your data and click Build Chart." />
      )}
    </WizardShell>
  )
}
