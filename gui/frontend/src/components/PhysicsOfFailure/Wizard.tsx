/**
 * Physics-of-Failure model wizard.  The first question identifies the dominant
 * failure-mechanism family; the second identifies the engineering question and
 * maps it to one of the calculators in this module.
 */
import { useState } from 'react'
import WizardShell, { OptionCard, RecommendationCard, RecInfo } from '../shared/WizardShell'

export type PoFModel =
  | 'sn' | 'stress-strain' | 'creep' | 'damage' | 'fracture'
  | 'coffin-manson' | 'norris-landzberg' | 'electromigration' | 'peck' | 'arrhenius'
  | 'eyring' | 'hallberg-peck' | 'tddb' | 'mean-stress'

type Mechanism = 'thermal' | 'fatigue' | 'humidity' | 'electrical' | 'mechanical'

interface ModelOption {
  id: PoFModel
  title: string
  desc: string
}

const MODEL_OPTIONS: Record<Mechanism, ModelOption[]> = {
  thermal: [
    { id: 'arrhenius', title: 'Temperature-only acceleration', desc: 'Translate life between an elevated test temperature and a use temperature.' },
    { id: 'eyring', title: 'Temperature with a pre-exponential term', desc: 'Use generalized Arrhenius behavior with an additional temperature exponent.' },
  ],
  fatigue: [
    { id: 'coffin-manson', title: 'Strain-controlled / low-cycle fatigue', desc: 'Relate total strain amplitude to reversals or cycles to failure.' },
    { id: 'norris-landzberg', title: 'Solder-joint thermal cycling', desc: 'Account for temperature range, cycle frequency, and maximum temperature.' },
    { id: 'sn', title: 'Stress-life test data', desc: 'Fit an S-N curve from stress amplitudes and observed cycles to failure.' },
    { id: 'damage', title: 'Variable-amplitude loading', desc: 'Accumulate fatigue damage across several stress levels with Miner\'s rule.' },
    { id: 'mean-stress', title: 'Mean-stress correction', desc: 'Check an alternating/mean stress pair with Goodman or Soderberg.' },
  ],
  humidity: [
    { id: 'hallberg-peck', title: 'Test-to-use acceleration factor', desc: 'Compare known temperature and relative-humidity test/use conditions.' },
    { id: 'peck', title: 'Time-to-failure model', desc: 'Estimate TTF from a Peck constant, humidity, temperature, and activation energy.' },
  ],
  electrical: [
    { id: 'electromigration', title: 'Metal interconnect electromigration', desc: 'Estimate MTTF from current density and temperature using Black\'s equation.' },
    { id: 'tddb', title: 'Dielectric breakdown', desc: 'Accelerate oxide/dielectric life by electric field and temperature.' },
  ],
  mechanical: [
    { id: 'fracture', title: 'Crack / fracture assessment', desc: 'Compare stress intensity with toughness and optionally integrate Paris-law growth.' },
    { id: 'creep', title: 'Sustained load at high temperature', desc: 'Estimate creep-rupture life with the Larson-Miller parameter.' },
    { id: 'stress-strain', title: 'Material stress-strain response', desc: 'Generate elastic/plastic response from Young\'s modulus and Ramberg-Osgood terms.' },
  ],
}

const RECOMMENDATIONS: Record<PoFModel, RecInfo> = {
  arrhenius: {
    title: 'Arrhenius acceleration', detail: 'Inputs: Ea, Tuse, Ttest, optional test life',
    rationale: 'Use this when temperature is the dominant accelerating stress and the mechanism is thermally activated over the range of interest.',
    cautions: ['Use absolute temperature internally and avoid extrapolating across a change in failure mechanism.'],
    alternatives: [{ label: 'Eyring', note: 'When a temperature pre-exponential term is supported by the mechanism or data.' }],
  },
  eyring: {
    title: 'Eyring acceleration', detail: 'Inputs: Ea, temperature exponent n, Tuse, Ttest',
    rationale: 'Eyring generalizes Arrhenius with a temperature power term, making it suitable when the rate prefactor has a known temperature dependence.',
    cautions: ['The extra exponent should be physically justified or estimated from enough multi-temperature data.'],
    alternatives: [{ label: 'Arrhenius', note: 'Prefer the simpler model when temperature-only activation is adequate.' }],
  },
  'coffin-manson': {
    title: 'Coffin-Manson strain-life', detail: 'Inputs: E, fatigue strength/ductility coefficients and exponents',
    rationale: 'Use strain-life analysis for low-cycle fatigue where plastic strain is appreciable and strain amplitude is the meaningful load measure.',
    cautions: ['Coefficients are material-, temperature-, and process-dependent.'],
    alternatives: [{ label: 'S-N Curve', note: 'For predominantly elastic, stress-controlled high-cycle fatigue.' }],
  },
  'norris-landzberg': {
    title: 'Norris-Landzberg', detail: 'Inputs: temperature ranges, frequencies, Tmax, n, m, Ea',
    rationale: 'This model is tailored to solder-joint thermal-cycling acceleration and includes the key cycle-range, frequency, and temperature effects.',
    cautions: ['Use coefficients appropriate to the solder alloy, package, and cycle regime.'],
    alternatives: [{ label: 'Coffin-Manson', note: 'When measured strain, rather than thermal-cycle conditions, is available.' }],
  },
  sn: {
    title: 'S-N stress-life curve', detail: 'Inputs: paired stress amplitudes and cycles to failure',
    rationale: 'Fit this model when you have fatigue-test results at several stress amplitudes and need life at a specified stress (or the inverse).',
    cautions: ['Keep stress ratio, environment, material condition, and failure definition consistent across points.'],
    alternatives: [{ label: "Miner's Rule", note: 'To combine an existing S-N relationship with a variable load spectrum.' }],
  },
  damage: {
    title: "Miner's linear damage rule", detail: 'Inputs: applied cycles and cycles-to-failure at each stress level',
    rationale: 'Miner\'s rule combines a variable-amplitude duty cycle into one cumulative fatigue-damage index.',
    cautions: ['It ignores load sequence and interaction effects; validate when overloads or non-proportional loading matter.'],
    alternatives: [{ label: 'S-N Curve', note: 'To first establish cycles-to-failure at each stress level.' }],
  },
  'mean-stress': {
    title: 'Goodman / Soderberg correction', detail: 'Inputs: alternating stress, mean stress, endurance and material strengths',
    rationale: 'Use this to judge a cyclic operating point when a nonzero tensile mean stress reduces the allowable alternating stress.',
    cautions: ['Soderberg is more conservative; neither criterion replaces a detailed fatigue analysis.'],
    alternatives: [{ label: 'S-N Curve', note: 'For life prediction after the stress state has been corrected.' }],
  },
  'hallberg-peck': {
    title: 'Hallberg-Peck acceleration', detail: 'Inputs: RHuse, RHtest, Tuse, Ttest, Ea, n',
    rationale: 'Use this for temperature-humidity test acceleration when both test and field conditions are known.',
    cautions: ['Confirm the same moisture-driven mechanism is active at test and use conditions.'],
    alternatives: [{ label: 'Peck model', note: 'For a direct time-to-failure calculation at a specified condition.' }],
  },
  peck: {
    title: 'Peck temperature-humidity model', detail: 'Inputs: A, RH, T, humidity exponent n, Ea',
    rationale: 'Peck models moisture-driven time to failure using relative humidity and thermally activated kinetics.',
    cautions: ['Avoid RH near condensation and temperatures that introduce a different mechanism.'],
    alternatives: [{ label: 'Hallberg-Peck', note: 'For a direct test-to-use acceleration-factor calculation.' }],
  },
  electromigration: {
    title: "Black's electromigration equation", detail: 'Inputs: A, current density J, exponent n, Ea, temperature',
    rationale: 'Black\'s equation is the standard first-order life model for current-density-driven metal-interconnect wear-out.',
    cautions: ['Current crowding and line geometry can make local current density much higher than the nominal value.'],
    alternatives: [],
  },
  tddb: {
    title: 'Time-dependent dielectric breakdown', detail: 'Inputs: Euse, Etest, Tuse, Ttest, field model and constants',
    rationale: 'Use TDDB acceleration for field- and temperature-driven degradation of gate oxides or other dielectric layers.',
    cautions: ['Choose E or 1/E behavior from device physics and supporting data, not fit quality alone.'],
    alternatives: [],
  },
  fracture: {
    title: 'LEFM / Paris-law fracture mechanics', detail: 'Inputs: stress, crack size, geometry factor, KIc; optional crack-growth terms',
    rationale: 'Use fracture mechanics when a crack-like flaw is present and stress intensity or crack propagation governs failure.',
    cautions: ['Linear-elastic assumptions require a small plastic zone relative to the crack and remaining ligament.'],
    alternatives: [{ label: 'Stress-Strain', note: 'Check material response first when yielding may invalidate LEFM.' }],
  },
  creep: {
    title: 'Larson-Miller creep life', detail: 'Inputs: temperature, stress, Larson-Miller constant and fit coefficients',
    rationale: 'The Larson-Miller parameter correlates high-temperature, sustained-load rupture data across time and temperature.',
    cautions: ['Use coefficients from the same alloy, heat treatment, and relevant stress/temperature range.'],
    alternatives: [],
  },
  'stress-strain': {
    title: 'Ramberg-Osgood stress-strain response', detail: 'Inputs: E, strength coefficient K, hardening exponent n',
    rationale: 'Use this to distinguish elastic and plastic response and estimate total strain over a stress range.',
    cautions: ['The fitted material curve may not capture cyclic hardening, rate effects, or temperature dependence.'],
    alternatives: [{ label: 'Fracture Mechanics', note: 'When a pre-existing crack, rather than bulk yielding, controls failure.' }],
  },
}

export default function PoFWizard({ open, onClose, onApply }: {
  open: boolean
  onClose: () => void
  onApply: (model: PoFModel) => void
}) {
  const [mechanism, setMechanism] = useState<Mechanism | null>(null)
  const [model, setModel] = useState<PoFModel | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  if (!open) return null

  const restart = () => { setMechanism(null); setModel(null); setStepIdx(0) }
  const chooseMechanism = (next: Mechanism) => {
    setMechanism(next)
    if (!MODEL_OPTIONS[next].some(o => o.id === model)) setModel(null)
  }
  const rec = model ? RECOMMENDATIONS[model] : null

  return (
    <WizardShell
      open={open}
      onClose={onClose}
      title="Physics-of-Failure model wizard"
      stepCount={3}
      stepIdx={stepIdx}
      isFinal={stepIdx === 2}
      canNext={stepIdx === 0 ? mechanism !== null : model !== null}
      onBack={() => setStepIdx(i => Math.max(0, i - 1))}
      onNext={() => setStepIdx(i => Math.min(2, i + 1))}
      onRestart={restart}
      onApply={() => model && onApply(model)}
      applyLabel="Use this model"
    >
      {stepIdx === 0 && (
        <>
          <p className="text-xs text-gray-600 mb-1">What primarily drives the failure mechanism?</p>
          <OptionCard title="Temperature / thermal aging" desc="A steady elevated temperature accelerates a chemical or material process." selected={mechanism === 'thermal'} onClick={() => chooseMechanism('thermal')} />
          <OptionCard title="Cyclic loading / thermal cycling" desc="Repeated stress, strain, vibration, or temperature swings consume fatigue life." selected={mechanism === 'fatigue'} onClick={() => chooseMechanism('fatigue')} />
          <OptionCard title="Humidity + temperature" desc="Moisture-related degradation is accelerated by humidity and temperature." selected={mechanism === 'humidity'} onClick={() => chooseMechanism('humidity')} />
          <OptionCard title="Electrical field / current" desc="Current density or dielectric electric field drives wear-out." selected={mechanism === 'electrical'} onClick={() => chooseMechanism('electrical')} />
          <OptionCard title="Mechanical load / material response" desc="Yielding, creep, an existing crack, or crack growth controls failure." selected={mechanism === 'mechanical'} onClick={() => chooseMechanism('mechanical')} />
        </>
      )}

      {stepIdx === 1 && mechanism && (
        <>
          <p className="text-xs text-gray-600 mb-1">Which engineering question best matches your case?</p>
          {MODEL_OPTIONS[mechanism].map(option => (
            <OptionCard key={option.id} title={option.title} desc={option.desc}
              selected={model === option.id} onClick={() => setModel(option.id)} />
          ))}
        </>
      )}

      {stepIdx === 2 && rec && (
        <RecommendationCard rec={rec}
          footNote="Applying opens the recommended calculator. Review its assumptions and enter conditions from the active failure mechanism." />
      )}
    </WizardShell>
  )
}
