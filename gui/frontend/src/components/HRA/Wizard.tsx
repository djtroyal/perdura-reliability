/**
 * HRA tool picker — guides selection among implemented methods and explicitly
 * identified screening worksheets. Applying jumps to the chosen tab.
 */
import { useState } from 'react'
import WizardShell, { OptionCard, RecommendationCard, RecInfo } from '../shared/WizardShell'

export interface MethodRecommendation extends RecInfo {
  /** HRA tab id (matches TOOLS ids in HRA/index.tsx). */
  sub: string
}

type Purpose = 'screening' | 'detailed'
type Frame = 'procedural' | 'generic' | 'psf' | 'cognitive' | 'expert' | 'efc' | 'mission'

interface Answers {
  purpose: Purpose | null
  frame: Frame | null
  procDetail: 'quantify' | 'worksheet'
  perStep: 'yes' | 'no'
}

const INITIAL: Answers = { purpose: null, frame: null, procDetail: 'quantify', perStep: 'no' }

export function recommend(a: Answers): MethodRecommendation | null {
  if (a.purpose === null) return null
  if (a.purpose === 'screening') {
    return {
      sub: 'jhedi',
      title: 'Category-factor screen',
      detail: 'Inputs: task category + count of aggravating factors',
      rationale: 'For rapid prioritization, this local heuristic multiplies a category anchor by a fixed factor per aggravating condition. It is useful for ranking tasks consistently within one screening exercise.',
      cautions: ['The anchors and multiplier are local and uncalibrated. Use the score for prioritization, and choose a calibrated HRA method when a quantitative HEP is required.'],
      alternatives: [{ label: 'HEART', note: 'Nearly as fast, with a more defensible EPC basis.' }],
    }
  }
  switch (a.frame) {
    case 'procedural':
      return a.procDetail === 'quantify'
        ? {
            sub: 'therp',
            title: 'THERP',
            detail: 'Inputs: nominal HEP + stress/experience modifiers (+ dependency)',
            rationale: 'THERP (NUREG/CR-1278) is the classic first-generation method for proceduralized, step-by-step tasks: nominal HEPs from its handbook tables, adjusted for stress and experience, with an explicit dependency model between consecutive tasks.',
            cautions: ['First-generation: models manual execution well, cognition/diagnosis weakly — pair with a cognitive method for diagnosis-heavy tasks.'],
            alternatives: [{ label: 'Error-mode screen', note: 'Structured task-step prioritization when handbook HEPs are unavailable.' }],
          }
        : {
            sub: 'sherpa',
            title: 'Error-mode likelihood screen',
            detail: 'Inputs: task steps × error mode × likelihood (L/M/H) × criticality',
            rationale: 'This SHERPA-inspired worksheet classifies each task step by error mode and a local likelihood band, making a qualitative review easier to prioritize.',
            cautions: ['The 0.001/0.01/0.1 anchors are local assumptions and row independence is imposed by the aggregation. This is not a complete SHERPA workflow or a validated task HEP.'],
            alternatives: [{ label: 'THERP', note: 'Handbook-based quantification of the same task structure.' }],
          }
    case 'generic':
      return {
        sub: 'heart',
        title: 'HEART',
        detail: 'Inputs: generic task type + error-producing conditions with assessed proportions',
        rationale: 'HEART assigns a nominal HEP from one of nine generic task types, then multiplies in the error-producing conditions (EPCs) you judge present, each weighted by how strongly it applies — fast, widely used, and industry-agnostic.',
        cautions: ['EPC "proportion of affect" judgments drive the answer — document the reasoning behind each.'],
        alternatives: [{ label: 'SPAR-H', note: 'PSF-based alternative common in nuclear PRA.' }],
      }
    case 'psf':
      return {
        sub: 'spar-h',
        title: 'SPAR-H',
        detail: 'Inputs: diagnosis vs action + eight PSFs + optional dependency context',
        rationale: 'SPAR-H (NUREG/CR-6883) uses diagnosis/action nominal HEPs, eight standardized performance-shaping factors, formal dependency equations, and an uncertainty distribution around the final mean.',
        cautions: ['Document each PSF and dependency judgment. PSFs overlap conceptually, so avoid double-counting the same adverse context.'],
        alternatives: [{ label: 'HEART', note: 'EPC-checklist style, less nuclear-specific.' }],
      }
    case 'cognitive':
      return a.perStep === 'yes'
        ? {
            sub: 'cream-extended',
            title: 'CREAM Extended',
            detail: 'Inputs: CPC ratings + each step classified by cognitive activity & failure type',
            rationale: 'The extended CREAM method classifies every task step by its cognitive function (observe/interpret/plan/execute) and failure type, then adjusts each generic failure probability by the common performance conditions — the most detailed second-generation option here.',
            cautions: ['More effort than basic CREAM; needs a defensible cognitive decomposition of the task.'],
            alternatives: [{ label: 'CREAM (basic)', note: 'Control-mode screening from the same CPC ratings.' }],
          }
        : {
            sub: 'cream',
            title: 'CREAM (basic)',
            detail: 'Inputs: nine common performance condition (CPC) ratings',
            rationale: 'Basic CREAM rates the nine common performance conditions and maps them to a control mode (strategic → scrambled), giving an HEP interval that reflects HOW WELL the context supports the operator — a fast second-generation contextual assessment.',
            cautions: ['Produces an interval, not a point estimate; use Extended CREAM for per-step numbers.'],
            alternatives: [{ label: 'CREAM Extended', note: 'Per-step quantification from the same context ratings.' }],
          }
    case 'expert':
      return {
        sub: 'slim',
        title: 'SLIM-MAUD',
        detail: 'Inputs: weighted PSF ratings + two calibration tasks with known HEPs',
        rationale: 'When no handbook data fits but experts can RATE the task\'s performance-shaping factors, SLIM converts the weighted ratings into a success-likelihood index and calibrates it against two anchor tasks with known HEPs.',
        cautions: ['The two calibration anchors dominate the result — choose tasks with genuinely well-established HEPs.'],
        alternatives: [{ label: 'HEART', note: 'If generic task types fit, it avoids the calibration burden.' }],
      }
    case 'efc':
      return {
        sub: 'atheana',
        title: 'EFC elicitation screen',
        detail: 'Inputs: unsafe action + error-forcing context + min/mode/max estimates',
        rationale: 'This worksheet records an unsafe action, its hypothesized error-forcing context, and one triangular expert judgment as an early screening artifact.',
        cautions: ['This is not ATHEANA. A defensible ATHEANA result requires the structured HFE/unsafe-action and EFC searches, dependency treatment, multidisciplinary review, and consensus quantification described in NUREG-1624/1880.'],
        alternatives: [],
      }
    case 'mission':
      return {
        sub: 'mermos',
        title: 'Mission-scenario screen',
        detail: 'Inputs: mission statement + failure-scenario list with probabilities',
        rationale: 'This screen totals analyst-supplied mission-failure scenarios after explicit confirmation that they are mutually exclusive and use compatible unconditional probabilities.',
        cautions: ['This is not MERMOS. Overlapping or conditional scenarios cannot be added directly, and scenario completeness remains an unsupported analyst assumption.'],
        alternatives: [],
      }
    default:
      return null
  }
}

type StepId = 'purpose' | 'frame' | 'procdetail' | 'perstep' | 'rec'

function stepsFor(a: Answers): StepId[] {
  if (a.purpose === 'screening') return ['purpose', 'rec']
  if (a.purpose === 'detailed') {
    if (a.frame === 'procedural') return ['purpose', 'frame', 'procdetail', 'rec']
    if (a.frame === 'cognitive') return ['purpose', 'frame', 'perstep', 'rec']
    return ['purpose', 'frame', 'rec']
  }
  return ['purpose']
}

export default function HRAWizard({ open, onClose, onApply }: {
  open: boolean
  onClose: () => void
  onApply: (sub: string) => void
}) {
  const [a, setA] = useState<Answers>(INITIAL)
  const [stepIdx, setStepIdx] = useState(0)
  if (!open) return null

  const set = (p: Partial<Answers>) => setA(prev => ({ ...prev, ...p }))
  const steps = stepsFor(a)
  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const rec = step === 'rec' ? recommend(a) : null
  const canNext = step === 'purpose' ? a.purpose !== null
    : step === 'frame' ? a.frame !== null
    : true

  return (
    <WizardShell
      open={open}
      onClose={onClose}
      title="Method wizard"
      stepCount={steps.length}
      stepIdx={stepIdx}
      isFinal={step === 'rec'}
      canNext={canNext}
      onBack={() => setStepIdx(i => i - 1)}
      onNext={() => canNext && setStepIdx(i => i + 1)}
      onRestart={() => { setA(INITIAL); setStepIdx(0) }}
      onApply={() => rec && onApply(rec.sub)}
      applyLabel="Open this method"
    >
      {step === 'purpose' && (
        <>
          <p className="text-xs text-gray-600 mb-1">What do you need from the analysis?</p>
          <OptionCard title="Quick screening bound" desc="A fast, conservative HEP to prioritize — is this task even worth detailed analysis?" selected={a.purpose === 'screening'} onClick={() => set({ purpose: 'screening' })} />
          <OptionCard title="Detailed quantification" desc="A defensible task-specific HEP for a PRA / safety case." selected={a.purpose === 'detailed'} onClick={() => set({ purpose: 'detailed' })} />
        </>
      )}

      {step === 'frame' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Which best describes the task and the inputs you have?</p>
          <OptionCard title="Proceduralized step-by-step task" desc="A written procedure executed step by step (valve line-ups, checklists)." selected={a.frame === 'procedural'} onClick={() => set({ frame: 'procedural' })} />
          <OptionCard title="Generic task + conditions checklist" desc="The task fits a generic type; you can judge which error-producing conditions apply." selected={a.frame === 'generic'} onClick={() => set({ frame: 'generic' })} />
          <OptionCard title="Diagnosis + action rated by PSFs" desc="Nuclear-PRA style: rate time, stress, complexity, procedures, ergonomics…" selected={a.frame === 'psf'} onClick={() => set({ frame: 'psf' })} />
          <OptionCard title="Context-driven cognitive assessment" desc="How well do the working conditions support cognition? (2nd-generation CREAM)" selected={a.frame === 'cognitive'} onClick={() => set({ frame: 'cognitive' })} />
          <OptionCard title="Expert-judgment calibration" desc="No handbook data fits, but experts can rate factors against anchor tasks." selected={a.frame === 'expert'} onClick={() => set({ frame: 'expert' })} />
          <OptionCard title="Error-forcing context (commission)" desc="Screen what situation could make the wrong action look right; full ATHEANA is outside this tool." selected={a.frame === 'efc'} onClick={() => set({ frame: 'efc' })} />
          <OptionCard title="Post-initiator crew mission" desc="Screen mutually-exclusive mission-failure scenarios; full MERMOS is outside this tool." selected={a.frame === 'mission'} onClick={() => set({ frame: 'mission' })} />
        </>
      )}

      {step === 'procdetail' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Quantify from handbook data, or review with a structured worksheet?</p>
          <OptionCard title="Quantify (THERP)" desc="Nominal HEPs with stress/experience modifiers and task dependency." selected={a.procDetail === 'quantify'} onClick={() => set({ procDetail: 'quantify' })} />
          <OptionCard title="Error-mode screening worksheet" desc="Classify each step's credible error mode and local likelihood band." selected={a.procDetail === 'worksheet'} onClick={() => set({ procDetail: 'worksheet' })} />
        </>
      )}

      {step === 'perstep' && (
        <>
          <p className="text-xs text-gray-600 mb-1">Do you need per-step failure probabilities?</p>
          <OptionCard title="No — overall context assessment" desc="A control-mode judgment and HEP interval for the task as a whole." selected={a.perStep === 'no'} onClick={() => set({ perStep: 'no' })} />
          <OptionCard title="Yes — classify each step" desc="Assign a cognitive activity and failure type to every step." selected={a.perStep === 'yes'} onClick={() => set({ perStep: 'yes' })} />
        </>
      )}

      {step === 'rec' && rec && (
        <RecommendationCard rec={rec} footNote="Applying opens the tool's tab — review its scope and assumptions before computing." />
      )}
    </WizardShell>
  )
}
