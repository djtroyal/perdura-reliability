import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { Play, Plus, Trash2, Wand2 } from 'lucide-react'
import {
  computeSNCurve, computeStressStrain, computeCreepLife,
  computeLinearDamage, computeFracture,
  computeCoffinManson, computeNorrisLandzberg, computeElectromigration,
  computePeck, computeArrhenius,
  computeEyring, computeHallbergPeck, computeTDDB, computeMeanStress,
  SNCurveResponse, StressStrainResponse, CreepResponse,
  DamageResponse, FractureResponse,
  CoffinMansonResponse, NorrisLandzbergResponse, ElectromigrationResponse,
  PeckResponse, ArrheniusResponse,
  EyringResponse, HallbergPeckResponse, TDDBResponse, MeanStressResponse,
  PoFAnalysisContract, PoFUncertaintySpec,
} from '../../api/client'
import { useFolioState } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import ExportResultsButton from '../shared/ExportResultsButton'
import NumberField from '../shared/NumberField'
import ConfidenceInput from '../shared/ConfidenceInput'
import { Card } from '../shared/ui'
import { inputCls, labelCls } from '../shared/styles'
import Latex from '../shared/Latex'
import {
  ACTIVATION_ENERGIES, SOLDER_FATIGUE, NORRIS_LANDZBERG, TDDB_PRESETS,
  MEAN_STRESS_MATERIALS,
} from './componentLibrary'
import PoFWizard, { type PoFModel } from './Wizard'
import { useHelpTopic } from '../help/context'
import { InfluenceScope, InfluenceSource, InfluenceTarget } from '../shared/InfluenceCues'
import ExampleButton from '../shared/ExampleButton'

type SubTab = PoFModel

// Models grouped by failure-mechanism family for the submodule navigation.
const SUB_TAB_GROUPS: { group: string; tabs: { id: SubTab; label: string }[] }[] = [
  {
    group: 'Thermal / temperature',
    tabs: [
      { id: 'arrhenius', label: 'Arrhenius' },
      { id: 'eyring', label: 'Eyring' },
    ],
  },
  {
    group: 'Thermal cycling / fatigue',
    tabs: [
      { id: 'coffin-manson', label: 'Coffin-Manson' },
      { id: 'norris-landzberg', label: 'Norris-Landzberg' },
      { id: 'sn', label: 'S-N Curve' },
      { id: 'damage', label: "Miner's Rule" },
      { id: 'mean-stress', label: 'Mean-Stress Correction' },
    ],
  },
  {
    group: 'Humidity / temperature-humidity',
    tabs: [
      { id: 'peck', label: 'Peck (T-H)' },
      { id: 'hallberg-peck', label: 'Hallberg-Peck' },
    ],
  },
  {
    group: 'Electrical / electromigration',
    tabs: [
      { id: 'electromigration', label: 'Electromigration' },
      { id: 'tddb', label: 'TDDB' },
    ],
  },
  {
    group: 'Mechanical / creep / wear',
    tabs: [
      { id: 'creep', label: 'Creep Life' },
      { id: 'fracture', label: 'Fracture Mechanics' },
      { id: 'stress-strain', label: 'Stress-Strain' },
    ],
  },
]

// --- Miner's Rule row ---
interface DamageRow {
  stress: string
  cyclesApplied: string
  cyclesToFailure: string
  damageExponent: string
}

// --- Module state ---
interface PoFState {
  subTab: SubTab

  // SN Curve
  snStress: string
  snCycles: string
  snStressQuery: string
  snLifeQuery: string
  snResult?: SNCurveResponse | null

  // Stress-Strain
  ssE: string
  ssK: string
  ssN: string
  ssSigmaY: string
  ssMaxStress: string
  ssResult?: StressStrainResponse | null

  // Creep Life
  crTemp: string
  crStress: string
  crC: string
  crLmpA: string
  crLmpB: string
  crTimeUnit: string
  crResult?: CreepResponse | null

  // Miner's Rule
  dmgRows: DamageRow[]
  dmgResult?: DamageResponse | null

  // Fracture Mechanics
  frSigma: string
  frA: string
  frY: string
  frKIc: string
  frC: string
  frM: string
  frAInitial: string
  frDeltaSigma: string
  frStressRatio: string
  frWalkerC: string
  frWalkerM: string
  frWalkerGamma: string
  frFormanC: string
  frFormanM: string
  frYieldStrength: string
  frRemainingLigament: string
  frResult?: FractureResponse | null

  // Coffin-Manson
  cmE: string
  cmSigmaF: string
  cmB: string
  cmEpsilonF: string
  cmC: string
  cmStrainQuery: string
  cmResult?: CoffinMansonResponse | null

  // Norris-Landzberg
  nlDtUse: string
  nlDtTest: string
  nlFUse: string
  nlFTest: string
  nlTMaxUse: string
  nlTMaxTest: string
  nlN: string
  nlM: string
  nlEa: string
  nlCyclesTest: string
  nlResult?: NorrisLandzbergResponse | null

  // Electromigration (Black's equation)
  emA: string
  emJ: string
  emN: string
  emEa: string
  emT: string
  emTimeUnit: string
  emResult?: ElectromigrationResponse | null

  // Peck temperature-humidity
  pkA: string
  pkRH: string
  pkN: string
  pkEa: string
  pkT: string
  pkRHUse: string
  pkTUse: string
  pkTimeUnit: string
  pkResult?: PeckResponse | null

  // Arrhenius
  arEa: string
  arTUse: string
  arTTest: string
  arLifeTest: string
  arLifeUnit: string
  arResult?: ArrheniusResponse | null

  // Eyring
  eyEa: string
  eyTUse: string
  eyTTest: string
  eyN: string
  eyLifeTest: string
  eyLifeUnit: string
  eyResult?: EyringResponse | null

  // Hallberg-Peck
  hpEa: string
  hpN: string
  hpRHUse: string
  hpRHTest: string
  hpTUse: string
  hpTTest: string
  hpLifeTest: string
  hpLifeUnit: string
  hpResult?: HallbergPeckResponse | null

  // TDDB
  tdModel: string
  tdGamma: string
  tdEa: string
  tdEUse: string
  tdETest: string
  tdTUse: string
  tdTTest: string
  tdLifeTest: string
  tdLifeUnit: string
  tdResult?: TDDBResponse | null

  // Mean-stress correction (Goodman / Soderberg)
  msMethod: string
  msSigmaA: string
  msSigmaM: string
  msSe: string
  msSu: string
  msSy: string
  msResult?: MeanStressResponse | null

  // Shared optional independent-input Monte Carlo propagation
  pofUncertaintyEnabled: boolean
  pofUncertaintyCv: string
  pofUncertaintySamples: string
  pofUncertaintyConfidence: string
  pofUncertaintyFields: Partial<Record<SubTab, string[]>>
}

const INITIAL_STATE: PoFState = {
  subTab: 'sn',

  snStress: '',
  snCycles: '',
  snStressQuery: '',
  snLifeQuery: '',

  ssE: '200000',
  ssK: '1200',
  ssN: '0.15',
  ssSigmaY: '',
  ssMaxStress: '',

  crTemp: '500',
  crStress: '100',
  crC: '20',
  crLmpA: '25',
  crLmpB: '-0.01',
  crTimeUnit: 'hours',

  dmgRows: [{ stress: '', cyclesApplied: '', cyclesToFailure: '', damageExponent: '' }],

  frSigma: '100',
  frA: '0.005',
  frY: '1.12',
  frKIc: '50',
  frC: '',
  frM: '',
  frAInitial: '',
  frDeltaSigma: '',
  frStressRatio: '',
  frWalkerC: '',
  frWalkerM: '',
  frWalkerGamma: '0.5',
  frFormanC: '',
  frFormanM: '',
  frYieldStrength: '',
  frRemainingLigament: '',

  cmE: '200000',
  cmSigmaF: '900',
  cmB: '-0.09',
  cmEpsilonF: '0.5',
  cmC: '-0.6',
  cmStrainQuery: '',

  nlDtUse: '60',
  nlDtTest: '100',
  nlFUse: '2',
  nlFTest: '48',
  nlTMaxUse: '60',
  nlTMaxTest: '100',
  nlN: '1.9',
  nlM: '0.333',
  nlEa: '0.122',
  nlCyclesTest: '',

  emA: '100000',
  emJ: '1000000',
  emN: '2.0',
  emEa: '0.7',
  emT: '100',
  emTimeUnit: 'hours',

  pkA: '100000',
  pkRH: '85',
  pkN: '2.7',
  pkEa: '0.79',
  pkT: '85',
  pkRHUse: '',
  pkTUse: '',
  pkTimeUnit: 'hours',

  arEa: '0.7',
  arTUse: '55',
  arTTest: '125',
  arLifeTest: '',
  arLifeUnit: 'hours',

  eyEa: '0.7',
  eyTUse: '55',
  eyTTest: '125',
  eyN: '0',
  eyLifeTest: '',
  eyLifeUnit: 'hours',

  hpEa: '0.9',
  hpN: '3',
  hpRHUse: '50',
  hpRHTest: '85',
  hpTUse: '30',
  hpTTest: '85',
  hpLifeTest: '',
  hpLifeUnit: 'hours',

  tdModel: 'E',
  tdGamma: '4',
  tdEa: '0.6',
  tdEUse: '4',
  tdETest: '8',
  tdTUse: '55',
  tdTTest: '125',
  tdLifeTest: '',
  tdLifeUnit: 'hours',

  msMethod: 'goodman',
  msSigmaA: '100',
  msSigmaM: '150',
  msSe: '200',
  msSu: '500',
  msSy: '350',

  pofUncertaintyEnabled: false,
  pofUncertaintyCv: '10',
  pofUncertaintySamples: '2000',
  pofUncertaintyConfidence: '0.95',
  pofUncertaintyFields: {},
}

const parseNumbers = (text: string) =>
  text.split(/[\s,\n]+/).map(Number).filter(n => !isNaN(n))

const MODEL_EQUATIONS: Record<SubTab, { label: string; tex: string }> = {
  sn: { label: 'Basquin stress-life model', tex: String.raw`S = A N^{b}` },
  'stress-strain': {
    label: 'Ramberg-Osgood relation',
    tex: String.raw`\varepsilon = \frac{\sigma}{E} + \left(\frac{\sigma}{K}\right)^{1/n}`,
  },
  creep: {
    label: 'Larson-Miller parameter',
    tex: String.raw`P = T\!\left(C + \log_{10} t_r\right) = a + b\log_{10}\sigma`,
  },
  damage: { label: "Miner's linear damage rule", tex: String.raw`D = \sum_i \frac{n_i}{N_i}` },
  fracture: {
    label: 'LEFM and Paris crack growth',
    tex: String.raw`K_I = Y\sigma\sqrt{\pi a}, \qquad \frac{da}{dN} = C\left(\Delta K\right)^m`,
  },
  'coffin-manson': {
    label: 'Coffin-Manson strain-life model',
    tex: String.raw`\frac{\Delta\varepsilon}{2} = \frac{\sigma_f'}{E}(2N)^b + \varepsilon_f'(2N)^c`,
  },
  'norris-landzberg': {
    label: 'Norris-Landzberg acceleration factor',
    tex: String.raw`\mathrm{AF} = \left(\frac{\Delta T_{\mathrm{test}}}{\Delta T_{\mathrm{use}}}\right)^n \left(\frac{f_{\mathrm{use}}}{f_{\mathrm{test}}}\right)^m \exp\!\left[\frac{E_a}{k}\left(\frac{1}{T_{\mathrm{use}}}-\frac{1}{T_{\mathrm{test}}}\right)\right]`,
  },
  electromigration: {
    label: "Black's electromigration equation",
    tex: String.raw`\mathrm{MTTF} = A J^{-n}\exp\!\left(\frac{E_a}{kT}\right)`,
  },
  peck: {
    label: "Peck's temperature-humidity model",
    tex: String.raw`\mathrm{TTF} = A\,\mathrm{RH}^{-n}\exp\!\left(\frac{E_a}{kT}\right)`,
  },
  arrhenius: {
    label: 'Arrhenius acceleration factor',
    tex: String.raw`\mathrm{AF} = \exp\!\left[\frac{E_a}{k}\left(\frac{1}{T_{\mathrm{use}}}-\frac{1}{T_{\mathrm{test}}}\right)\right]`,
  },
  eyring: {
    label: 'Eyring acceleration factor',
    tex: String.raw`\mathrm{AF} = \left(\frac{T_{\mathrm{test}}}{T_{\mathrm{use}}}\right)^n \exp\!\left[\frac{E_a}{k}\left(\frac{1}{T_{\mathrm{use}}}-\frac{1}{T_{\mathrm{test}}}\right)\right]`,
  },
  'hallberg-peck': {
    label: 'Hallberg-Peck acceleration factor',
    tex: String.raw`\mathrm{AF} = \left(\frac{\mathrm{RH}_{\mathrm{test}}}{\mathrm{RH}_{\mathrm{use}}}\right)^n \exp\!\left[\frac{E_a}{k}\left(\frac{1}{T_{\mathrm{use}}}-\frac{1}{T_{\mathrm{test}}}\right)\right]`,
  },
  tddb: {
    label: 'TDDB E-model acceleration factor',
    tex: String.raw`\mathrm{AF} = \exp\!\left[\gamma(E_{\mathrm{test}}-E_{\mathrm{use}})\right] \exp\!\left[\frac{E_a}{k}\left(\frac{1}{T_{\mathrm{use}}}-\frac{1}{T_{\mathrm{test}}}\right)\right]`,
  },
  'mean-stress': {
    label: 'Modified Goodman criterion',
    tex: String.raw`\frac{\sigma_a}{S_e} + \frac{\sigma_m}{S_u} = \frac{1}{n}`,
  },
}

interface UncertaintyOption { field: string; label: string }
const UNCERTAINTY_OPTIONS: Record<SubTab, UncertaintyOption[]> = {
  sn: [],
  'stress-strain': [
    { field: 'E', label: 'Young\'s modulus E' }, { field: 'K', label: 'Strength coefficient K' },
    { field: 'n', label: 'Hardening exponent n' }, { field: 'sigma_y', label: 'Yield stress (if provided)' },
    { field: 'max_stress', label: 'Maximum stress (if provided)' },
  ],
  creep: [
    { field: 'temperature_C', label: 'Temperature' }, { field: 'stress_MPa', label: 'Stress' },
    { field: 'C', label: 'Larson-Miller C' }, { field: 'lmp_coeffs[0]', label: 'LMP coefficient a' },
    { field: 'lmp_coeffs[1]', label: 'LMP coefficient b' },
  ],
  damage: [],
  fracture: [
    { field: 'sigma', label: 'Applied stress' }, { field: 'a', label: 'Crack length' },
    { field: 'Y', label: 'Geometry factor' }, { field: 'K_Ic', label: 'Fracture toughness' },
    { field: 'C', label: 'Paris C' }, { field: 'm', label: 'Paris m' },
    { field: 'delta_sigma', label: 'Cyclic stress range (if provided)' },
  ],
  'coffin-manson': [
    { field: 'E', label: 'Young\'s modulus E' }, { field: 'sigma_f', label: 'Fatigue strength coefficient' },
    { field: 'b', label: 'Strength exponent b' }, { field: 'epsilon_f', label: 'Ductility coefficient' },
    { field: 'c', label: 'Ductility exponent c' }, { field: 'strain_query', label: 'Strain query (if provided)' },
  ],
  'norris-landzberg': [
    { field: 'dT_use', label: 'ΔT use' }, { field: 'dT_test', label: 'ΔT test' },
    { field: 'f_use', label: 'Use frequency' }, { field: 'f_test', label: 'Test frequency' },
    { field: 'T_max_use', label: 'Maximum use temperature' }, { field: 'T_max_test', label: 'Maximum test temperature' },
    { field: 'n', label: 'Range exponent n' }, { field: 'm', label: 'Frequency exponent m' },
    { field: 'Ea', label: 'Activation energy' }, { field: 'cycles_test', label: 'Test cycles (if provided)' },
  ],
  electromigration: [
    { field: 'A', label: 'Calibrated constant A' }, { field: 'J', label: 'Current density' },
    { field: 'n', label: 'Current exponent' }, { field: 'Ea', label: 'Activation energy' },
    { field: 'T', label: 'Temperature' },
  ],
  peck: [
    { field: 'A', label: 'Calibrated constant A' }, { field: 'RH', label: 'Test humidity' },
    { field: 'n', label: 'Humidity exponent' }, { field: 'Ea', label: 'Activation energy' },
    { field: 'T', label: 'Test temperature' }, { field: 'RH_use', label: 'Use humidity (if provided)' },
    { field: 'T_use', label: 'Use temperature (if provided)' },
  ],
  arrhenius: [
    { field: 'Ea', label: 'Activation energy' }, { field: 'T_use', label: 'Use temperature' },
    { field: 'T_test', label: 'Test temperature' }, { field: 'life_test', label: 'Test life (if provided)' },
  ],
  eyring: [
    { field: 'Ea', label: 'Activation energy' }, { field: 'T_use', label: 'Use temperature' },
    { field: 'T_test', label: 'Test temperature' }, { field: 'n', label: 'Temperature exponent' },
    { field: 'life_test', label: 'Test life (if provided)' },
  ],
  'hallberg-peck': [
    { field: 'Ea', label: 'Activation energy' }, { field: 'n', label: 'Humidity exponent' },
    { field: 'RH_use', label: 'Use humidity' }, { field: 'RH_test', label: 'Test humidity' },
    { field: 'T_use', label: 'Use temperature' }, { field: 'T_test', label: 'Test temperature' },
    { field: 'life_test', label: 'Test life (if provided)' },
  ],
  tddb: [
    { field: 'gamma', label: 'Field acceleration γ' }, { field: 'Ea', label: 'Activation energy' },
    { field: 'E_use', label: 'Use electric field' }, { field: 'E_test', label: 'Test electric field' },
    { field: 'T_use', label: 'Use temperature' }, { field: 'T_test', label: 'Test temperature' },
    { field: 'life_test', label: 'Test life (if provided)' },
  ],
  'mean-stress': [
    { field: 'sigma_a', label: 'Alternating stress' }, { field: 'sigma_m', label: 'Mean stress' },
    { field: 'Se', label: 'Endurance limit' }, { field: 'Su', label: 'Ultimate strength' },
    { field: 'Sy', label: 'Yield strength' },
  ],
}

export default function PhysicsOfFailure() {
  const [s, setS, folios] = useFolioState<PoFState>('pof', INITIAL_STATE)
  const patch = (p: Partial<PoFState>) => setS(prev => ({ ...prev, ...p }))
  const subTab = s.subTab
  useHelpTopic(`pof.${subTab}`)

  const uncertaintyOptions: UncertaintyOption[] = subTab === 'sn'
    ? [
        ...parseNumbers(s.snStress).map((_, i) => ({ field: `stress_amplitude[${i}]`, label: `Stress datum ${i + 1}` })),
        ...parseNumbers(s.snCycles).map((_, i) => ({ field: `cycles_to_failure[${i}]`, label: `Life datum ${i + 1}` })),
        ...(s.snStressQuery.trim() ? [{ field: 'stress_query', label: 'Stress query' }] : []),
        ...(s.snLifeQuery.trim() ? [{ field: 'life_query', label: 'Life query' }] : []),
      ]
    : subTab === 'damage'
      ? s.dmgRows.flatMap((_, i) => [
          { field: `stress_levels[${i}]`, label: `Level ${i + 1} stress` },
          { field: `cycles_applied[${i}]`, label: `Level ${i + 1} applied cycles` },
          { field: `cycles_to_failure[${i}]`, label: `Level ${i + 1} failure cycles` },
        ])
      : UNCERTAINTY_OPTIONS[subTab]
  const selectedUncertaintyFields = s.pofUncertaintyFields[subTab] ?? []
  const toggleUncertaintyField = (field: string) => {
    const next = selectedUncertaintyFields.includes(field)
      ? selectedUncertaintyFields.filter(value => value !== field)
      : [...selectedUncertaintyFields, field]
    patch({ pofUncertaintyFields: { ...s.pofUncertaintyFields, [subTab]: next } })
  }
  const uncertaintyPayload = (): PoFUncertaintySpec | undefined => {
    if (!s.pofUncertaintyEnabled) return undefined
    const cv = (parseFloat(s.pofUncertaintyCv) || 0) / 100
    const confidence = parseFloat(s.pofUncertaintyConfidence)
    return {
      relative_sd: Object.fromEntries(selectedUncertaintyFields.map(field => [field, cv])),
      samples: Math.max(200, Math.min(20000, parseInt(s.pofUncertaintySamples, 10) || 2000)),
      confidence: Number.isFinite(confidence) && confidence > 0 && confidence < 1
        ? confidence : 0.95,
    }
  }

  const activeEquation = subTab === 'tddb' && s.tdModel === '1/E'
    ? {
        label: 'TDDB 1/E-model acceleration factor',
        tex: String.raw`\mathrm{AF} = \exp\!\left[\gamma\left(\frac{1}{E_{\mathrm{use}}}-\frac{1}{E_{\mathrm{test}}}\right)\right] \exp\!\left[\frac{E_a}{k}\left(\frac{1}{T_{\mathrm{use}}}-\frac{1}{T_{\mathrm{test}}}\right)\right]`,
      }
    : subTab === 'mean-stress' && s.msMethod !== 'goodman'
      ? s.msMethod === 'soderberg'
        ? {
            label: 'Soderberg criterion',
            tex: String.raw`\frac{\sigma_a}{S_e} + \frac{\sigma_m}{S_y} = \frac{1}{n}`,
          }
        : {
            label: 'Gerber criterion',
            tex: String.raw`\frac{\sigma_a}{S_e} + \left(\frac{\sigma_m}{S_u}\right)^2 = 1`,
          }
      : MODEL_EQUATIONS[subTab]

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)

  // ---------- SN Curve ----------
  const runSN = async () => {
    const stress = parseNumbers(s.snStress)
    const cycles = parseNumbers(s.snCycles)
    if (stress.length < 3 || cycles.length < 3) {
      setError('Enter at least 3 data points for stress and cycles.'); return
    }
    if (stress.length !== cycles.length) {
      setError('Stress amplitudes and cycles must have equal length.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeSNCurve({
        stress_amplitude: stress,
        cycles_to_failure: cycles,
        stress_query: s.snStressQuery.trim() ? parseFloat(s.snStressQuery) : null,
        life_query: s.snLifeQuery.trim() ? parseFloat(s.snLifeQuery) : null,
        uncertainty: uncertaintyPayload(),
      })
      patch({ snResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing S-N curve.')
    } finally { setLoading(false) }
  }

  // ---------- Stress-Strain ----------
  const runSS = async () => {
    const E = parseFloat(s.ssE)
    if (isNaN(E) || E <= 0) { setError('Young\'s modulus E must be positive.'); return }
    setError(null); setLoading(true)
    try {
      const res = await computeStressStrain({
        E,
        K: s.ssK.trim() ? parseFloat(s.ssK) : undefined,
        n: s.ssN.trim() ? parseFloat(s.ssN) : undefined,
        sigma_y: s.ssSigmaY.trim() ? parseFloat(s.ssSigmaY) : null,
        max_stress: s.ssMaxStress.trim() ? parseFloat(s.ssMaxStress) : null,
        uncertainty: uncertaintyPayload(),
      })
      patch({ ssResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing stress-strain.')
    } finally { setLoading(false) }
  }

  // ---------- Creep Life ----------
  const runCreep = async () => {
    const temp = parseFloat(s.crTemp)
    const stress = parseFloat(s.crStress)
    if (isNaN(temp) || isNaN(stress)) { setError('Temperature and stress are required.'); return }
    const C = s.crC.trim() ? parseFloat(s.crC) : undefined
    const a = parseFloat(s.crLmpA)
    const b = parseFloat(s.crLmpB)
    if (isNaN(a) || isNaN(b)) { setError('LMP coefficients a and b are required.'); return }
    setError(null); setLoading(true)
    try {
      const res = await computeCreepLife({
        temperature_C: temp,
        stress_MPa: stress,
        C,
        lmp_coeffs: [a, b],
        time_unit: s.crTimeUnit,
        uncertainty: uncertaintyPayload(),
      })
      patch({ crResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing creep life.')
    } finally { setLoading(false) }
  }

  // ---------- Miner's Rule ----------
  const dmgRows = s.dmgRows
  const addDmgRow = () =>
    patch({ dmgRows: [...dmgRows, { stress: '', cyclesApplied: '', cyclesToFailure: '', damageExponent: '' }] })
  const removeDmgRow = (idx: number) =>
    patch({ dmgRows: dmgRows.filter((_, i) => i !== idx) })
  const updateDmgRow = (idx: number, field: keyof DamageRow, value: string) =>
    patch({ dmgRows: dmgRows.map((r, i) => i === idx ? { ...r, [field]: value } : r) })

  const runDamage = async () => {
    const stressLevels = dmgRows.map(r => parseFloat(r.stress))
    const cyclesApplied = dmgRows.map(r => parseFloat(r.cyclesApplied))
    const cyclesToFailure = dmgRows.map(r => parseFloat(r.cyclesToFailure))
    if (stressLevels.some(isNaN) || cyclesApplied.some(isNaN) || cyclesToFailure.some(isNaN)) {
      setError('All fields in every row must be valid numbers.'); return
    }
    if (dmgRows.length === 0) { setError('Add at least one stress level row.'); return }
    const hasDamageExponents = dmgRows.some(row => row.damageExponent.trim() !== '')
    if (hasDamageExponents && dmgRows.some(row => row.damageExponent.trim() === '' || !(parseFloat(row.damageExponent) > 0))) {
      setError('Provide one positive nonlinear damage exponent for every row, or leave all exponents blank.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeLinearDamage({
        stress_levels: stressLevels,
        cycles_applied: cyclesApplied,
        cycles_to_failure: cyclesToFailure,
        damage_exponents: hasDamageExponents ? dmgRows.map(row => parseFloat(row.damageExponent)) : null,
        uncertainty: uncertaintyPayload(),
      })
      patch({ dmgResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing damage.')
    } finally { setLoading(false) }
  }

  // ---------- Fracture Mechanics ----------
  const runFracture = async () => {
    const sigma = parseFloat(s.frSigma)
    const a = parseFloat(s.frA)
    const Y = parseFloat(s.frY)
    const K_Ic = parseFloat(s.frKIc)
    if (isNaN(sigma) || isNaN(a) || isNaN(Y) || isNaN(K_Ic)) {
      setError('sigma, a, Y, and K_Ic are required.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeFracture({
        sigma, a, Y, K_Ic,
        C: s.frC.trim() ? parseFloat(s.frC) : undefined,
        m: s.frM.trim() ? parseFloat(s.frM) : undefined,
        a_initial: s.frAInitial.trim() ? parseFloat(s.frAInitial) : null,
        delta_sigma: s.frDeltaSigma.trim() ? parseFloat(s.frDeltaSigma) : null,
        stress_ratio: s.frStressRatio.trim() ? parseFloat(s.frStressRatio) : null,
        walker_C: s.frWalkerC.trim() ? parseFloat(s.frWalkerC) : null,
        walker_m: s.frWalkerM.trim() ? parseFloat(s.frWalkerM) : null,
        walker_gamma: s.frWalkerGamma.trim() ? parseFloat(s.frWalkerGamma) : undefined,
        forman_C: s.frFormanC.trim() ? parseFloat(s.frFormanC) : null,
        forman_m: s.frFormanM.trim() ? parseFloat(s.frFormanM) : null,
        yield_strength: s.frYieldStrength.trim() ? parseFloat(s.frYieldStrength) : null,
        remaining_ligament: s.frRemainingLigament.trim() ? parseFloat(s.frRemainingLigament) : null,
        uncertainty: uncertaintyPayload(),
      })
      patch({ frResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing fracture.')
    } finally { setLoading(false) }
  }

  // ---------- Coffin-Manson ----------
  const runCoffinManson = async () => {
    const E = parseFloat(s.cmE)
    const sigmaF = parseFloat(s.cmSigmaF)
    if (isNaN(E) || E <= 0 || isNaN(sigmaF) || sigmaF <= 0) {
      setError('E and sigma_f\' must be positive numbers.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeCoffinManson({
        E,
        sigma_f: sigmaF,
        b: s.cmB.trim() ? parseFloat(s.cmB) : undefined,
        epsilon_f: s.cmEpsilonF.trim() ? parseFloat(s.cmEpsilonF) : undefined,
        c: s.cmC.trim() ? parseFloat(s.cmC) : undefined,
        strain_query: s.cmStrainQuery.trim() ? parseFloat(s.cmStrainQuery) : null,
        uncertainty: uncertaintyPayload(),
      })
      patch({ cmResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing Coffin-Manson strain-life.')
    } finally { setLoading(false) }
  }

  // ---------- Norris-Landzberg ----------
  const runNorrisLandzberg = async () => {
    const dtUse = parseFloat(s.nlDtUse)
    const dtTest = parseFloat(s.nlDtTest)
    const fUse = parseFloat(s.nlFUse)
    const fTest = parseFloat(s.nlFTest)
    const tMaxUse = parseFloat(s.nlTMaxUse)
    const tMaxTest = parseFloat(s.nlTMaxTest)
    if ([dtUse, dtTest, fUse, fTest, tMaxUse, tMaxTest].some(isNaN)) {
      setError('All use/test condition fields are required.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeNorrisLandzberg({
        dT_use: dtUse, dT_test: dtTest,
        f_use: fUse, f_test: fTest,
        T_max_use: tMaxUse, T_max_test: tMaxTest,
        n: s.nlN.trim() ? parseFloat(s.nlN) : undefined,
        m: s.nlM.trim() ? parseFloat(s.nlM) : undefined,
        Ea: s.nlEa.trim() ? parseFloat(s.nlEa) : undefined,
        cycles_test: s.nlCyclesTest.trim() ? parseFloat(s.nlCyclesTest) : null,
        uncertainty: uncertaintyPayload(),
      })
      patch({ nlResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing Norris-Landzberg AF.')
    } finally { setLoading(false) }
  }

  // ---------- Electromigration (Black's equation) ----------
  const runElectromigration = async () => {
    const A = parseFloat(s.emA)
    const J = parseFloat(s.emJ)
    const T = parseFloat(s.emT)
    if (isNaN(A) || A <= 0 || isNaN(J) || J <= 0 || isNaN(T)) {
      setError('A, J, and T are required (A and J must be positive).'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeElectromigration({
        A, J, T,
        n: s.emN.trim() ? parseFloat(s.emN) : undefined,
        Ea: s.emEa.trim() ? parseFloat(s.emEa) : undefined,
        time_unit: s.emTimeUnit,
        uncertainty: uncertaintyPayload(),
      })
      patch({ emResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing electromigration MTTF.')
    } finally { setLoading(false) }
  }

  // ---------- Peck temperature-humidity ----------
  const runPeck = async () => {
    const A = parseFloat(s.pkA)
    const RH = parseFloat(s.pkRH)
    const T = parseFloat(s.pkT)
    if (isNaN(A) || A <= 0 || isNaN(RH) || RH <= 0 || isNaN(T)) {
      setError('A, RH, and T are required (A and RH must be positive).'); return
    }
    const hasRHUse = s.pkRHUse.trim() !== ''
    const hasTUse = s.pkTUse.trim() !== ''
    if (hasRHUse !== hasTUse) {
      setError('Provide both RH_use and T_use, or neither.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computePeck({
        A, RH, T,
        n: s.pkN.trim() ? parseFloat(s.pkN) : undefined,
        Ea: s.pkEa.trim() ? parseFloat(s.pkEa) : undefined,
        RH_use: hasRHUse ? parseFloat(s.pkRHUse) : null,
        T_use: hasTUse ? parseFloat(s.pkTUse) : null,
        time_unit: s.pkTimeUnit,
        uncertainty: uncertaintyPayload(),
      })
      patch({ pkResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing Peck model.')
    } finally { setLoading(false) }
  }

  // ---------- Arrhenius ----------
  const runArrhenius = async () => {
    const Ea = parseFloat(s.arEa)
    const tUse = parseFloat(s.arTUse)
    const tTest = parseFloat(s.arTTest)
    if (isNaN(Ea) || isNaN(tUse) || isNaN(tTest)) {
      setError('Ea, T_use, and T_test are required.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeArrhenius({
        Ea, T_use: tUse, T_test: tTest,
        life_test: s.arLifeTest.trim() ? parseFloat(s.arLifeTest) : null,
        life_unit: s.arLifeUnit,
        uncertainty: uncertaintyPayload(),
      })
      patch({ arResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing Arrhenius AF.')
    } finally { setLoading(false) }
  }

  // ---------- Eyring ----------
  const runEyring = async () => {
    const Ea = parseFloat(s.eyEa)
    const tUse = parseFloat(s.eyTUse)
    const tTest = parseFloat(s.eyTTest)
    if (isNaN(Ea) || isNaN(tUse) || isNaN(tTest)) {
      setError('Ea, T_use, and T_test are required.'); return
    }
    if (tTest <= tUse) {
      setError('Test temperature must be greater than use temperature.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeEyring({
        Ea, T_use: tUse, T_test: tTest,
        n: s.eyN.trim() ? parseFloat(s.eyN) : undefined,
        life_test: s.eyLifeTest.trim() ? parseFloat(s.eyLifeTest) : null,
        life_unit: s.eyLifeUnit,
        uncertainty: uncertaintyPayload(),
      })
      patch({ eyResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing Eyring AF.')
    } finally { setLoading(false) }
  }

  // ---------- Hallberg-Peck ----------
  const runHallbergPeck = async () => {
    const rhUse = parseFloat(s.hpRHUse)
    const rhTest = parseFloat(s.hpRHTest)
    const tUse = parseFloat(s.hpTUse)
    const tTest = parseFloat(s.hpTTest)
    if (isNaN(rhUse) || rhUse <= 0 || isNaN(rhTest) || rhTest <= 0 || isNaN(tUse) || isNaN(tTest)) {
      setError('RH and temperature conditions are required (RH must be positive).'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeHallbergPeck({
        Ea: s.hpEa.trim() ? parseFloat(s.hpEa) : undefined,
        n: s.hpN.trim() ? parseFloat(s.hpN) : undefined,
        RH_use: rhUse, RH_test: rhTest, T_use: tUse, T_test: tTest,
        life_test: s.hpLifeTest.trim() ? parseFloat(s.hpLifeTest) : null,
        life_unit: s.hpLifeUnit,
        uncertainty: uncertaintyPayload(),
      })
      patch({ hpResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing Hallberg-Peck AF.')
    } finally { setLoading(false) }
  }

  // ---------- TDDB ----------
  const runTDDB = async () => {
    const eUse = parseFloat(s.tdEUse)
    const eTest = parseFloat(s.tdETest)
    const tUse = parseFloat(s.tdTUse)
    const tTest = parseFloat(s.tdTTest)
    if (isNaN(eUse) || eUse <= 0 || isNaN(eTest) || eTest <= 0 || isNaN(tUse) || isNaN(tTest)) {
      setError('Electric fields and temperatures are required (fields must be positive).'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeTDDB({
        model: s.tdModel,
        gamma: s.tdGamma.trim() ? parseFloat(s.tdGamma) : undefined,
        Ea: s.tdEa.trim() ? parseFloat(s.tdEa) : undefined,
        E_use: eUse, E_test: eTest, T_use: tUse, T_test: tTest,
        life_test: s.tdLifeTest.trim() ? parseFloat(s.tdLifeTest) : null,
        life_unit: s.tdLifeUnit,
        uncertainty: uncertaintyPayload(),
      })
      patch({ tdResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing TDDB AF.')
    } finally { setLoading(false) }
  }

  // ---------- Mean-stress correction (Goodman / Soderberg) ----------
  const runMeanStress = async () => {
    const sigmaA = parseFloat(s.msSigmaA)
    const sigmaM = parseFloat(s.msSigmaM)
    const Se = parseFloat(s.msSe)
    if (isNaN(sigmaA) || sigmaA < 0 || isNaN(sigmaM) || sigmaM < 0) {
      setError('Alternating and mean stresses must be non-negative numbers.'); return
    }
    if (isNaN(Se) || Se <= 0) { setError('Endurance limit Se must be positive.'); return }
    const Su = parseFloat(s.msSu)
    const Sy = parseFloat(s.msSy)
    if (isNaN(Su) || Su <= 0 || isNaN(Sy) || Sy <= 0) {
      setError('Su and Sy must both be positive so all mean-stress criteria can be compared.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await computeMeanStress({
        method: s.msMethod,
        sigma_a: sigmaA, sigma_m: sigmaM, Se,
        Su, Sy,
        uncertainty: uncertaintyPayload(),
      })
      patch({ msResult: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing mean-stress correction.')
    } finally { setLoading(false) }
  }

  // ---------- Render helpers ----------
  const fieldCls = 'w-full py-1.5'
  const textareaCls = 'w-full h-20 text-xs border border-gray-300 rounded p-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-400'

  const runBtn = (onClick: () => void, label: string) => (
    <button onClick={onClick} disabled={loading}
      data-shortcut-primary data-shortcut-label={label}
      title={`${label} (Ctrl/⌘+Enter)`}
      className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
      <Play size={12} /> {loading ? 'Computing...' : label}
    </button>
  )

  const unitSelect = (label: string, value: string, onChange: (value: string) => void, includeCycles = false) => (
    <div>
      <label className={labelCls}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
        <option value="seconds">seconds</option><option value="minutes">minutes</option>
        <option value="hours">hours</option><option value="days">days</option>
        {includeCycles && <option value="cycles">cycles</option>}
      </select>
    </div>
  )

  // "Load from library" dropdown (#PoF library). Selecting an option fills the
  // relevant parameter fields; user can still override afterwards.
  const librarySelect = <T,>(
    label: string,
    options: { label: string; note?: string }[],
    onPick: (opt: T, idx: number) => void,
    rawOptions: T[],
  ) => (
    <div>
      <label className={labelCls}>{label}</label>
      <select
        defaultValue=""
        onChange={e => {
          const idx = parseInt(e.target.value, 10)
          if (!isNaN(idx)) onPick(rawOptions[idx], idx)
          e.target.value = ''
        }}
        className={inputCls}>
        <option value="">Load from library...</option>
        {options.map((o, i) => (
          <option key={i} value={i}>
            {o.label}{o.note ? ` (${o.note})` : ''}
          </option>
        ))}
      </select>
    </div>
  )

  // ========== LEFT PANEL ==========
  const renderLeftPanel = () => {
    switch (subTab) {
      case 'sn':
        return (
          <>
            <div>
              <label className={labelCls}>
                Stress amplitudes <span className="text-gray-400">(comma-separated)</span>
              </label>
              <textarea value={s.snStress} onChange={e => patch({ snStress: e.target.value })}
                className={textareaCls} placeholder="400, 350, 300, 250, 200..." />
            </div>
            <div>
              <label className={labelCls}>
                Cycles to failure <span className="text-gray-400">(comma-separated)</span>
              </label>
              <textarea value={s.snCycles} onChange={e => patch({ snCycles: e.target.value })}
                className={textareaCls} placeholder="1e4, 3e4, 1e5, 3e5, 1e6..." />
            </div>
            <div>
              <label className={labelCls}>
                Stress query <span className="text-gray-400">(optional, predict life)</span>
              </label>
              <NumberField value={s.snStressQuery} onChange={v => patch({ snStressQuery: v })}
                min={0} step={1} className={fieldCls} placeholder="e.g. 275" />
            </div>
            <div>
              <label className={labelCls}>
                Life query <span className="text-gray-400">(optional, predict stress)</span>
              </label>
              <NumberField value={s.snLifeQuery} onChange={v => patch({ snLifeQuery: v })}
                min={0} step={1} className={fieldCls} placeholder="e.g. 500000" />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runSN, 'Fit S-N Curve')}
          </>
        )

      case 'stress-strain':
        return (
          <>
            <div>
              <label className={labelCls}>E (Young's modulus, MPa)</label>
              <NumberField value={s.ssE} onChange={v => patch({ ssE: v })}
                min={0} step={1000} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>K (strength coefficient, MPa)</label>
              <NumberField value={s.ssK} onChange={v => patch({ ssK: v })}
                min={0} step={10} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>n (strain hardening exponent)</label>
              <NumberField value={s.ssN} onChange={v => patch({ ssN: v })}
                min={0} step={0.01} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>
                Yield stress, sigma_y <span className="text-gray-400">(optional, MPa)</span>
              </label>
              <NumberField value={s.ssSigmaY} onChange={v => patch({ ssSigmaY: v })}
                min={0} step={10} className={fieldCls} placeholder="e.g. 250" />
            </div>
            <div>
              <label className={labelCls}>
                Max stress <span className="text-gray-400">(optional, MPa)</span>
              </label>
              <NumberField value={s.ssMaxStress} onChange={v => patch({ ssMaxStress: v })}
                min={0} step={10} className={fieldCls} placeholder="e.g. 500" />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runSS, 'Compute Stress-Strain')}
          </>
        )

      case 'creep':
        return (
          <>
            <div>
              <label className={labelCls}>Temperature (deg C)</label>
              <NumberField value={s.crTemp} onChange={v => patch({ crTemp: v })}
                min={-273} step={5} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Stress (MPa)</label>
              <NumberField value={s.crStress} onChange={v => patch({ crStress: v })}
                min={0} step={1} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>C (Larson-Miller constant)</label>
              <NumberField value={s.crC} onChange={v => patch({ crC: v })}
                step={1} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>LMP coefficient a</label>
              <NumberField value={s.crLmpA} onChange={v => patch({ crLmpA: v })}
                step={1} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>LMP coefficient b</label>
              <NumberField value={s.crLmpB} onChange={v => patch({ crLmpB: v })}
                step={0.01} className={fieldCls} />
            </div>
            {unitSelect('Rupture-time unit used to calibrate C', s.crTimeUnit, value => patch({ crTimeUnit: value }))}
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runCreep, 'Compute Creep Life')}
          </>
        )

      case 'damage':
        return (
          <>
            <p className="text-xs text-gray-500">
              Enter stress levels with applied and failure cycles for each.
            </p>
            <ExampleButton
              hasData={dmgRows.some(row => row.stress.trim() || row.cyclesApplied.trim() || row.cyclesToFailure.trim())}
              onLoad={() => patch({
                dmgRows: [
                  { stress: '300', cyclesApplied: '10000', cyclesToFailure: '100000', damageExponent: '' },
                  { stress: '250', cyclesApplied: '30000', cyclesToFailure: '200000', damageExponent: '' },
                  { stress: '200', cyclesApplied: '50000', cyclesToFailure: '500000', damageExponent: '' },
                ],
                dmgResult: null,
              })}
            />
            <div className="flex flex-col gap-2">
              {dmgRows.map((row, i) => (
                <div key={i} className="border border-gray-200 rounded p-2 flex flex-col gap-1 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 font-medium">Level {i + 1}</span>
                    {dmgRows.length > 1 && (
                      <button onClick={() => removeDmgRow(i)}
                        className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Stress</label>
                    <NumberField value={row.stress} onChange={v => updateDmgRow(i, 'stress', v)}
                      min={0} step={1} className="w-full py-1" placeholder="e.g. 300" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Cycles applied</label>
                    <NumberField value={row.cyclesApplied} onChange={v => updateDmgRow(i, 'cyclesApplied', v)}
                      min={0} step={1} className="w-full py-1" placeholder="e.g. 10000" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Cycles to failure</label>
                    <NumberField value={row.cyclesToFailure} onChange={v => updateDmgRow(i, 'cyclesToFailure', v)}
                      min={1} step={1} className="w-full py-1" placeholder="e.g. 100000" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Nonlinear damage exponent q (optional)</label>
                    <NumberField value={row.damageExponent} onChange={v => updateDmgRow(i, 'damageExponent', v)}
                      min={0} step={0.1} className="w-full py-1" placeholder="all rows, e.g. 0.8" />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addDmgRow}
              className="flex items-center justify-center gap-1 border border-blue-600 text-blue-600 hover:bg-blue-50 text-xs font-medium py-1.5 rounded transition-colors">
              <Plus size={12} /> Add stress level
            </button>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runDamage, 'Compute Damage')}
          </>
        )

      case 'fracture':
        return (
          <>
            <p className="text-xs text-gray-500 mb-1">
              Linear elastic fracture mechanics (LEFM) assessment.
            </p>
            <div>
              <label className={labelCls}>Applied stress, sigma (MPa)</label>
              <NumberField value={s.frSigma} onChange={v => patch({ frSigma: v })}
                min={0} step={1} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Crack length, a (m)</label>
              <NumberField value={s.frA} onChange={v => patch({ frA: v })}
                min={0} step={0.001} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Geometry factor, Y</label>
              <NumberField value={s.frY} onChange={v => patch({ frY: v })}
                min={0} step={0.01} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Fracture toughness, K_Ic (MPa*m^0.5)</label>
              <NumberField value={s.frKIc} onChange={v => patch({ frKIc: v })}
                min={0} step={1} className={fieldCls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Yield strength (optional, MPa)</label>
                <NumberField value={s.frYieldStrength} onChange={v => patch({ frYieldStrength: v })}
                  min={0} step={5} className={fieldCls} placeholder="LEFM screen" />
              </div>
              <div>
                <label className={labelCls}>Remaining ligament (optional, m)</label>
                <NumberField value={s.frRemainingLigament} onChange={v => patch({ frRemainingLigament: v })}
                  min={0} step={0.001} className={fieldCls} placeholder="LEFM screen" />
              </div>
            </div>
            <hr className="border-gray-200" />
            <p className="text-[10px] text-gray-500">
              Optional: Paris law crack growth (provide C, m, a_initial, delta_sigma)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>C (Paris law)</label>
                <NumberField value={s.frC} onChange={v => patch({ frC: v })}
                  min={0} step={1e-12} className={fieldCls} placeholder="e.g. 1e-11" />
              </div>
              <div>
                <label className={labelCls}>m (Paris law)</label>
                <NumberField value={s.frM} onChange={v => patch({ frM: v })}
                  min={0} step={0.1} className={fieldCls} placeholder="e.g. 3" />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Initial crack length, a_initial <span className="text-gray-400">(m)</span>
              </label>
              <NumberField value={s.frAInitial} onChange={v => patch({ frAInitial: v })}
                min={0} step={0.001} className={fieldCls} placeholder="e.g. 0.001" />
            </div>
            <div>
              <label className={labelCls}>
                Stress range, delta_sigma <span className="text-gray-400">(MPa)</span>
              </label>
              <NumberField value={s.frDeltaSigma} onChange={v => patch({ frDeltaSigma: v })}
                min={0} step={1} className={fieldCls} placeholder="e.g. 150" />
            </div>
            <div>
              <label className={labelCls}>Stress ratio R (required for alternatives)</label>
              <NumberField value={s.frStressRatio} onChange={v => patch({ frStressRatio: v })}
                min={-0.999} max={0.999} step={0.05} className={fieldCls} placeholder="sigma_min / sigma_max" />
            </div>
            <details className="border border-gray-200 rounded p-2">
              <summary className="text-[11px] font-medium text-gray-700 cursor-pointer">Walker / Forman model sensitivity</summary>
              <p className="text-[10px] text-amber-700 my-2">Use coefficients fitted separately for each law in MPa√m and m/cycle units; coefficients are not transferable between models.</p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>Walker C</label><NumberField value={s.frWalkerC} onChange={v => patch({ frWalkerC: v })} min={0} step={1e-12} className={fieldCls} /></div>
                <div><label className={labelCls}>Walker m</label><NumberField value={s.frWalkerM} onChange={v => patch({ frWalkerM: v })} min={0} step={0.1} className={fieldCls} /></div>
                <div><label className={labelCls}>Walker γ</label><NumberField value={s.frWalkerGamma} onChange={v => patch({ frWalkerGamma: v })} min={0} max={1} step={0.05} className={fieldCls} /></div>
                <div />
                <div><label className={labelCls}>Forman C</label><NumberField value={s.frFormanC} onChange={v => patch({ frFormanC: v })} min={0} step={1e-12} className={fieldCls} /></div>
                <div><label className={labelCls}>Forman m</label><NumberField value={s.frFormanM} onChange={v => patch({ frFormanM: v })} min={0} step={0.1} className={fieldCls} /></div>
              </div>
            </details>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runFracture, 'Analyze Fracture')}
          </>
        )

      case 'coffin-manson':
        return (
          <>
            {librarySelect('Solder / material library', SOLDER_FATIGUE,
              (o: typeof SOLDER_FATIGUE[number]) => patch({
                cmE: String(o.E), cmSigmaF: String(o.sigma_f),
                cmB: String(o.b), cmEpsilonF: String(o.epsilon_f), cmC: String(o.c),
              }),
              SOLDER_FATIGUE)}
            <div>
              <label className={labelCls}>E (Young's modulus, MPa)</label>
              <NumberField value={s.cmE} onChange={v => patch({ cmE: v })}
                min={0} step={1000} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>sigma_f' (fatigue strength coeff., MPa)</label>
              <NumberField value={s.cmSigmaF} onChange={v => patch({ cmSigmaF: v })}
                min={0} step={10} className={fieldCls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>b (strength exponent)</label>
                <NumberField value={s.cmB} onChange={v => patch({ cmB: v })}
                  max={0} step={0.01} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>c (ductility exponent)</label>
                <NumberField value={s.cmC} onChange={v => patch({ cmC: v })}
                  max={0} step={0.01} className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>eps_f' (fatigue ductility coeff.)</label>
              <NumberField value={s.cmEpsilonF} onChange={v => patch({ cmEpsilonF: v })}
                min={0} step={0.01} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>
                Strain query <span className="text-gray-400">(optional, total strain amplitude)</span>
              </label>
              <NumberField value={s.cmStrainQuery} onChange={v => patch({ cmStrainQuery: v })}
                min={0} step={0.001} className={fieldCls} placeholder="e.g. 0.005" />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runCoffinManson, 'Compute Strain-Life')}
          </>
        )

      case 'norris-landzberg':
        return (
          <>
            <p className="text-xs text-gray-500 mb-1">
              Solder-joint thermal fatigue acceleration factor.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>dT use (deg C)</label>
                <NumberField value={s.nlDtUse} onChange={v => patch({ nlDtUse: v })}
                  min={0} step={5} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>dT test (deg C)</label>
                <NumberField value={s.nlDtTest} onChange={v => patch({ nlDtTest: v })}
                  min={0} step={5} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>f use (cycles/day)</label>
                <NumberField value={s.nlFUse} onChange={v => patch({ nlFUse: v })}
                  min={0} step={1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>f test (cycles/day)</label>
                <NumberField value={s.nlFTest} onChange={v => patch({ nlFTest: v })}
                  min={0} step={1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>T max use (deg C)</label>
                <NumberField value={s.nlTMaxUse} onChange={v => patch({ nlTMaxUse: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>T max test (deg C)</label>
                <NumberField value={s.nlTMaxTest} onChange={v => patch({ nlTMaxTest: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
            </div>
            <hr className="border-gray-200" />
            {librarySelect('Solder constants library', NORRIS_LANDZBERG,
              (o: typeof NORRIS_LANDZBERG[number]) => patch({
                nlN: String(o.n), nlM: String(o.m), nlEa: String(o.Ea),
              }),
              NORRIS_LANDZBERG)}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>n</label>
                <NumberField value={s.nlN} onChange={v => patch({ nlN: v })}
                  min={0} step={0.1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>m</label>
                <NumberField value={s.nlM} onChange={v => patch({ nlM: v })}
                  min={0} step={0.01} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Ea (eV)</label>
                <NumberField value={s.nlEa} onChange={v => patch({ nlEa: v })}
                  min={0} step={0.01} className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Test cycles to failure <span className="text-gray-400">(optional)</span>
              </label>
              <NumberField value={s.nlCyclesTest} onChange={v => patch({ nlCyclesTest: v })}
                min={0} step={1} className={fieldCls} placeholder="e.g. 1000" />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runNorrisLandzberg, 'Compute AF')}
          </>
        )

      case 'electromigration':
        return (
          <>
            <div>
              <label className={labelCls}>A (constant)</label>
              <NumberField value={s.emA} onChange={v => patch({ emA: v })}
                min={0} step={1000} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>J (current density, A/cm^2)</label>
              <NumberField value={s.emJ} onChange={v => patch({ emJ: v })}
                min={0} step={10000} className={fieldCls} />
            </div>
            {librarySelect('Activation energy library', ACTIVATION_ENERGIES,
              (o: typeof ACTIVATION_ENERGIES[number]) => patch({ emEa: String(o.Ea) }),
              ACTIVATION_ENERGIES)}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>n (exponent)</label>
                <NumberField value={s.emN} onChange={v => patch({ emN: v })}
                  min={0} step={0.1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Ea (eV)</label>
                <NumberField value={s.emEa} onChange={v => patch({ emEa: v })}
                  min={0} step={0.01} className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>T (temperature, deg C)</label>
              <NumberField value={s.emT} onChange={v => patch({ emT: v })}
                min={-273} step={5} className={fieldCls} />
            </div>
            {unitSelect('Time unit represented by A', s.emTimeUnit, value => patch({ emTimeUnit: value }))}
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runElectromigration, 'Compute MTTF')}
          </>
        )

      case 'peck':
        return (
          <>
            <div>
              <label className={labelCls}>A (constant)</label>
              <NumberField value={s.pkA} onChange={v => patch({ pkA: v })}
                min={0} step={1000} className={fieldCls} />
            </div>
            {librarySelect('Activation energy library', ACTIVATION_ENERGIES,
              (o: typeof ACTIVATION_ENERGIES[number]) => patch({ pkEa: String(o.Ea) }),
              ACTIVATION_ENERGIES)}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>RH test (%)</label>
                <NumberField value={s.pkRH} onChange={v => patch({ pkRH: v })}
                  min={0} max={100} step={1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>T test (deg C)</label>
                <NumberField value={s.pkT} onChange={v => patch({ pkT: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>n (RH exponent)</label>
                <NumberField value={s.pkN} onChange={v => patch({ pkN: v })}
                  min={0} step={0.1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Ea (eV)</label>
                <NumberField value={s.pkEa} onChange={v => patch({ pkEa: v })}
                  min={0} step={0.01} className={fieldCls} />
              </div>
            </div>
            <hr className="border-gray-200" />
            <p className="text-[10px] text-gray-500">
              Optional: use conditions (both required for AF)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>RH use (%)</label>
                <NumberField value={s.pkRHUse} onChange={v => patch({ pkRHUse: v })}
                  min={0} max={100} step={1} className={fieldCls} placeholder="e.g. 50" />
              </div>
              <div>
                <label className={labelCls}>T use (deg C)</label>
                <NumberField value={s.pkTUse} onChange={v => patch({ pkTUse: v })}
                  min={-273} step={5} className={fieldCls} placeholder="e.g. 40" />
              </div>
            </div>
            {unitSelect('Time unit represented by A', s.pkTimeUnit, value => patch({ pkTimeUnit: value }))}
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runPeck, 'Compute TTF')}
          </>
        )

      case 'arrhenius':
        return (
          <>
            {librarySelect('Activation energy library', ACTIVATION_ENERGIES,
              (o: typeof ACTIVATION_ENERGIES[number]) => patch({ arEa: String(o.Ea) }),
              ACTIVATION_ENERGIES)}
            <div>
              <label className={labelCls}>Ea (signed apparent activation energy, eV)</label>
              <NumberField value={s.arEa} onChange={v => patch({ arEa: v })}
                step={0.01} className={fieldCls}
                title="Positive for ordinary thermal acceleration; zero for no temperature effect; negative for a supported inverse-temperature mechanism." />
              {parseFloat(s.arEa) < 0 && (
                <p className="mt-1 text-[10px] leading-snug text-amber-700">
                  Negative Ea is supported for inverse-temperature behavior. A hotter test will produce AF &lt; 1; use a colder test temperature when cold is the accelerating stress.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>T use (deg C)</label>
                <NumberField value={s.arTUse} onChange={v => patch({ arTUse: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>T test (deg C)</label>
                <NumberField value={s.arTTest} onChange={v => patch({ arTTest: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Test life <span className="text-gray-400">(optional)</span>
              </label>
              <NumberField value={s.arLifeTest} onChange={v => patch({ arLifeTest: v })}
                min={0} step={1} className={fieldCls} placeholder="e.g. 1000" />
            </div>
            {unitSelect('Test-life unit', s.arLifeUnit, value => patch({ arLifeUnit: value }), true)}
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runArrhenius, 'Compute AF')}
          </>
        )

      case 'eyring':
        return (
          <>
            {librarySelect('Activation energy library', ACTIVATION_ENERGIES,
              (o: typeof ACTIVATION_ENERGIES[number]) => patch({ eyEa: String(o.Ea) }),
              ACTIVATION_ENERGIES)}
            <div>
              <label className={labelCls}>Ea (activation energy, eV)</label>
              <NumberField value={s.eyEa} onChange={v => patch({ eyEa: v })}
                min={0} step={0.01} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>n (temperature pre-exponent)</label>
              <NumberField value={s.eyN} onChange={v => patch({ eyN: v })}
                step={0.1} className={fieldCls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>T use (deg C)</label>
                <NumberField value={s.eyTUse} onChange={v => patch({ eyTUse: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>T test (deg C)</label>
                <NumberField value={s.eyTTest} onChange={v => patch({ eyTTest: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Test life <span className="text-gray-400">(optional)</span>
              </label>
              <NumberField value={s.eyLifeTest} onChange={v => patch({ eyLifeTest: v })}
                min={0} step={1} className={fieldCls} placeholder="e.g. 1000" />
            </div>
            {unitSelect('Test-life unit', s.eyLifeUnit, value => patch({ eyLifeUnit: value }), true)}
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runEyring, 'Compute AF')}
          </>
        )

      case 'hallberg-peck':
        return (
          <>
            {librarySelect('Activation energy library', ACTIVATION_ENERGIES,
              (o: typeof ACTIVATION_ENERGIES[number]) => patch({ hpEa: String(o.Ea) }),
              ACTIVATION_ENERGIES)}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Ea (eV)</label>
                <NumberField value={s.hpEa} onChange={v => patch({ hpEa: v })}
                  min={0} step={0.01} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>n (RH exponent)</label>
                <NumberField value={s.hpN} onChange={v => patch({ hpN: v })}
                  min={0} step={0.1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>RH use (%)</label>
                <NumberField value={s.hpRHUse} onChange={v => patch({ hpRHUse: v })}
                  min={0} max={100} step={1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>RH test (%)</label>
                <NumberField value={s.hpRHTest} onChange={v => patch({ hpRHTest: v })}
                  min={0} max={100} step={1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>T use (deg C)</label>
                <NumberField value={s.hpTUse} onChange={v => patch({ hpTUse: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>T test (deg C)</label>
                <NumberField value={s.hpTTest} onChange={v => patch({ hpTTest: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Test life <span className="text-gray-400">(optional)</span>
              </label>
              <NumberField value={s.hpLifeTest} onChange={v => patch({ hpLifeTest: v })}
                min={0} step={1} className={fieldCls} placeholder="e.g. 1000" />
            </div>
            {unitSelect('Test-life unit', s.hpLifeUnit, value => patch({ hpLifeUnit: value }), true)}
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runHallbergPeck, 'Compute AF')}
          </>
        )

      case 'tddb':
        return (
          <>
            {librarySelect('Model / gamma library', TDDB_PRESETS,
              (o: typeof TDDB_PRESETS[number]) => patch({
                tdModel: o.model, tdGamma: String(o.gamma), tdEa: String(o.Ea),
              }),
              TDDB_PRESETS)}
            <div>
              <label className={labelCls}>Model</label>
              <select value={s.tdModel} onChange={e => patch({ tdModel: e.target.value })}
                className={inputCls}>
                <option value="E">E-model (thermochemical)</option>
                <option value="1/E">1/E-model (anode hole injection)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>gamma (field accel.)</label>
                <NumberField value={s.tdGamma} onChange={v => patch({ tdGamma: v })}
                  min={0} step={0.1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Ea (eV)</label>
                <NumberField value={s.tdEa} onChange={v => patch({ tdEa: v })}
                  min={0} step={0.01} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>E use (MV/cm)</label>
                <NumberField value={s.tdEUse} onChange={v => patch({ tdEUse: v })}
                  min={0} step={0.1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>E test (MV/cm)</label>
                <NumberField value={s.tdETest} onChange={v => patch({ tdETest: v })}
                  min={0} step={0.1} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>T use (deg C)</label>
                <NumberField value={s.tdTUse} onChange={v => patch({ tdTUse: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>T test (deg C)</label>
                <NumberField value={s.tdTTest} onChange={v => patch({ tdTTest: v })}
                  min={-273} step={5} className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Test life <span className="text-gray-400">(optional)</span>
              </label>
              <NumberField value={s.tdLifeTest} onChange={v => patch({ tdLifeTest: v })}
                min={0} step={1} className={fieldCls} placeholder="e.g. 1000" />
            </div>
            {unitSelect('Test-life unit', s.tdLifeUnit, value => patch({ tdLifeUnit: value }), true)}
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runTDDB, 'Compute AF')}
          </>
        )

      case 'mean-stress': {
        return (
          <>
            <div>
              <label className={labelCls}>Method</label>
              <select value={s.msMethod} onChange={e => patch({ msMethod: e.target.value })}
                className={inputCls}>
                <option value="goodman">Modified Goodman (uses Su)</option>
                <option value="soderberg">Soderberg (uses Sy)</option>
                <option value="gerber">Gerber parabola (uses Su)</option>
              </select>
            </div>
            {librarySelect('Material library', MEAN_STRESS_MATERIALS,
              (o: typeof MEAN_STRESS_MATERIALS[number]) => patch({
                msSu: String(o.Su), msSy: String(o.Sy), msSe: String(o.Se),
              }),
              MEAN_STRESS_MATERIALS)}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Alternating stress, sigma_a (MPa)</label>
                <NumberField value={s.msSigmaA} onChange={v => patch({ msSigmaA: v })}
                  min={0} step={5} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>Mean stress, sigma_m (MPa)</label>
                <NumberField value={s.msSigmaM} onChange={v => patch({ msSigmaM: v })}
                  min={0} step={5} className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Endurance limit, Se (MPa)</label>
              <NumberField value={s.msSe} onChange={v => patch({ msSe: v })}
                min={0} step={5} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>
                Ultimate tensile strength, Su (MPa)
              </label>
              <NumberField value={s.msSu} onChange={v => patch({ msSu: v })}
                min={0} step={5} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>
                Yield strength, Sy (MPa)
              </label>
              <NumberField value={s.msSy} onChange={v => patch({ msSy: v })}
                min={0} step={5} className={fieldCls} />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {runBtn(runMeanStress, 'Compute Factor of Safety')}
          </>
        )
      }
    }
  }

  // ========== MAIN CONTENT ==========
  // Result present for the active sub-tab (gates the Export button).
  const currentResult = {
    'sn': s.snResult,
    'stress-strain': s.ssResult,
    'creep': s.crResult,
    'damage': s.dmgResult,
    'fracture': s.frResult,
    'coffin-manson': s.cmResult,
    'norris-landzberg': s.nlResult,
    'electromigration': s.emResult,
    'peck': s.pkResult,
    'arrhenius': s.arResult,
    'eyring': s.eyResult,
    'hallberg-peck': s.hpResult,
    'tddb': s.tdResult,
    'mean-stress': s.msResult,
  }[subTab]

  const renderMainContent = () => {
    switch (subTab) {
      case 'sn': {
        const r = s.snResult
        if (!r) return <EmptyState text="Enter S-N data and click Fit S-N Curve" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="A (intercept)" value={r.A.toExponential(4)} />
              <Card label={r.b_lower != null && r.b_upper != null
                ? `b (exponent)  [${r.b_lower.toFixed(4)}, ${r.b_upper.toFixed(4)}]` : 'b (exponent)'}
                value={r.b.toFixed(4)}
                tip={r.b_se != null ? `Fitted slope ± its 95% CI (SE = ${r.b_se.toPrecision(3)}); the slope drives every life extrapolation.` : undefined} />
              <Card label="R-squared" value={r.r_squared != null ? r.r_squared.toFixed(4) : '—'} />
              <Card label="Endurance limit" value={`${r.endurance_limit.toFixed(1)} MPa`} />
            </div>
            {r.extrapolation_warning && (
              <div className="mb-6 p-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-xs leading-snug">
                {r.extrapolation_warning}
              </div>
            )}
            {r.prediction && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                {r.prediction.cycles != null && (
                  <Card label="Predicted life (cycles)" value={r.prediction.cycles.toExponential(3)} accent />
                )}
                {r.prediction.stress != null && (
                  <Card label="Predicted stress (MPa)" value={r.prediction.stress.toFixed(1)} accent />
                )}
              </div>
            )}
            {/* Plot */}
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: parseNumbers(s.snCycles),
                    y: parseNumbers(s.snStress),
                    mode: 'markers',
                    name: 'Data',
                    marker: { color: '#ef4444', size: 8 },
                  } as Plotly.Data,
                  {
                    x: r.curve.n,
                    y: r.curve.s,
                    mode: 'lines',
                    name: 'Basquin fit',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Cycles to Failure (N)' }, type: 'log', gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Stress Amplitude (MPa)' }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.7, y: 0.95, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'stress-strain': {
        const r = s.ssResult
        if (!r) return <EmptyState text="Set material properties and click Compute Stress-Strain" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-3 gap-3 mb-6">
              <Card label="E (MPa)" value={r.E.toLocaleString()} />
              <Card label="K (MPa)" value={r.K.toLocaleString()} />
              <Card label="n" value={r.n.toFixed(4)} />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.strain_total, y: r.stress,
                    mode: 'lines', name: 'Total strain',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: r.strain_elastic, y: r.stress,
                    mode: 'lines', name: 'Elastic strain',
                    line: { color: '#10b981', width: 1.5, dash: 'dash' },
                  } as Plotly.Data,
                  {
                    x: r.strain_plastic, y: r.stress,
                    mode: 'lines', name: 'Plastic strain',
                    line: { color: '#f59e0b', width: 1.5, dash: 'dot' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Strain' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Stress (MPa)' }, gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'creep': {
        const r = s.crResult
        if (!r) return <EmptyState text="Set creep parameters and click Compute Creep Life" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-3 gap-3 mb-6">
              <Card label="Larson-Miller Parameter" value={r.lmp.toFixed(1)} accent />
              <Card label="Temperature (K)" value={r.temperature_K.toFixed(1)} />
              <Card label={`Time to rupture (${r.time_unit})`} value={r.time_to_rupture.toExponential(3)} accent />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.curve.temperature_C, y: r.curve.time,
                    mode: 'lines', name: 'Rupture time vs T',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: [parseFloat(s.crTemp)],
                    y: [r.time_to_rupture],
                    mode: 'markers', name: 'Operating point',
                    marker: { color: '#ef4444', size: 10, symbol: 'diamond' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Temperature (deg C)' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: `Time to Rupture (${r.time_unit})` }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'damage': {
        const r = s.dmgResult
        if (!r) return <EmptyState text="Enter stress levels and click Compute Damage" />
        const damageColor = r.total_damage >= 1 ? 'text-red-700' :
          r.total_damage >= 0.5 ? 'text-amber-600' : 'text-green-700'
        const damageBg = r.total_damage >= 1 ? 'bg-red-50 border-red-200' :
          r.total_damage >= 0.5 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
        return (
          <div className="flex-1 overflow-y-auto p-6">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className={`rounded-lg border p-3 ${damageBg}`}>
                <p className="text-xs text-gray-500">Total damage (D)</p>
                <p className={`text-2xl font-bold ${damageColor}`}>{r.total_damage.toFixed(4)}</p>
              </div>
              <div className={`rounded-lg border p-3 ${damageBg}`}>
                <p className="text-xs text-gray-500">Remaining life</p>
                <p className={`text-2xl font-bold ${damageColor}`}>
                  {(r.remaining_life_fraction * 100).toFixed(1)}%
                </p>
              </div>
              <div className={`rounded-lg border p-3 ${r.failed ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <p className="text-xs text-gray-500">Status</p>
                <p className={`text-lg font-bold ${r.failed ? 'text-red-700' : 'text-green-700'}`}>
                  {r.failed ? 'FAILED' : 'SAFE'}
                </p>
              </div>
            </div>
            {r.nonlinear_damage && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                <Card label="Nonlinear damage (entered order)" value={r.nonlinear_damage.damage.toFixed(4)} accent />
                <Card label="Nonlinear damage (reverse order)" value={r.nonlinear_damage.reverse_order_damage.toFixed(4)} />
                <Card label="Sequence-effect difference" value={r.nonlinear_damage.sequence_effect.toFixed(4)} />
              </div>
            )}
            {/* Stacked bar chart */}
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
              <Plot
                data={r.damage_fractions.map((d, i) => ({
                  x: ['Cumulative Damage'],
                  y: [d],
                  type: 'bar',
                  name: `Level ${i + 1} (${(d * 100).toFixed(1)}%)`,
                  marker: {
                    color: ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'][i % 6],
                  },
                } as Plotly.Data))}
                layout={{
                  barmode: 'stack',
                  yaxis: { title: { text: 'Damage Fraction' }, gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 40, l: 60 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { font: { size: 10 } },
                  showlegend: true,
                  shapes: [{
                    type: 'line', x0: -0.5, x1: 0.5, y0: 1, y1: 1,
                    line: { color: '#ef4444', width: 2, dash: 'dash' },
                  }],
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'fracture': {
        const r = s.frResult
        if (!r) return <EmptyState text="Enter fracture parameters and click Analyze Fracture" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="K_I (MPa*m^0.5)" value={r.K_I.toFixed(2)} />
              <Card label="K_Ic (MPa*m^0.5)" value={r.K_Ic.toFixed(2)} />
              <div className={`rounded-lg border p-3 ${r.critical ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <p className="text-xs text-gray-500">Status</p>
                <p className={`text-lg font-bold ${r.critical ? 'text-red-700' : 'text-green-700'}`}>
                  {r.critical ? 'CRITICAL' : 'SAFE'}
                </p>
              </div>
              <Card label="Critical crack length (m)" value={r.critical_crack_length.toExponential(3)} />
            </div>
            {r.crack_growth_models && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                {Object.entries(r.crack_growth_models).map(([model, fit]) => (
                  <Card key={model} label={`${model[0].toUpperCase() + model.slice(1)} cycles to critical`}
                    value={fit.cycles_to_critical.toExponential(3)} accent={model === 'paris'} />
                ))}
              </div>
            )}
            {/* K_I vs K_Ic bar comparison */}
            <div className="grid gap-4" style={{ gridTemplateColumns: r.crack_growth_models ? '1fr 1fr' : '1fr' }}>
              <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
                <Plot
                  data={[
                    {
                      x: ['K_I', 'K_Ic'],
                      y: [r.K_I, r.K_Ic],
                      type: 'bar',
                      marker: {
                        color: [r.critical ? '#ef4444' : '#3b82f6', '#10b981'],
                      },
                    } as Plotly.Data,
                  ]}
                  layout={{
                    yaxis: { title: { text: 'Stress Intensity (MPa*m^0.5)' }, gridcolor: '#e5e7eb' },
                    margin: { t: 20, r: 20, b: 40, l: 70 },
                    paper_bgcolor: 'white', plot_bgcolor: 'white',
                    showlegend: false,
                  } as Partial<Plotly.Layout>}
                  config={{ responsive: true }}
                  style={{ width: '100%', height: '100%' }}
                  useResizeHandler
                />
              </div>
              {r.crack_growth_models && (
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
                  <Plot
                    data={Object.entries(r.crack_growth_models).map(([model, fit], i) => ({
                      x: fit.curve.cycles,
                      y: fit.curve.a,
                      mode: 'lines', name: model[0].toUpperCase() + model.slice(1),
                      line: { color: ['#3b82f6', '#f59e0b', '#10b981'][i % 3], width: 2 },
                    } as Plotly.Data))}
                    layout={{
                      xaxis: { title: { text: 'Cycles (N)' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'Crack Length a (m)' }, gridcolor: '#e5e7eb' },
                      margin: { t: 20, r: 20, b: 50, l: 70 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      showlegend: true,
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              )}
            </div>
          </div>
        )
      }

      case 'coffin-manson': {
        const r = s.cmResult
        if (!r) return <EmptyState text="Set strain-life parameters and click Compute Strain-Life" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              <Card label="Transition life (reversals, 2N)" value={r.transition_reversals.toExponential(3)} />
              <Card label="Transition life (cycles)" value={r.transition_cycles.toExponential(3)} />
              <Card label="Strain amplitude at transition" value={r.transition_strain.toExponential(3)} />
            </div>
            {r.prediction && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                <Card label="Predicted reversals (2N)" value={r.prediction.reversals.toExponential(3)} accent />
                <Card label="Predicted cycles (N)" value={r.prediction.cycles.toExponential(3)} accent />
              </div>
            )}
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.curve.reversals, y: r.curve.strain_total,
                    mode: 'lines', name: 'Total strain',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: r.curve.reversals, y: r.curve.strain_elastic,
                    mode: 'lines', name: 'Elastic strain',
                    line: { color: '#10b981', width: 1.5, dash: 'dash' },
                  } as Plotly.Data,
                  {
                    x: r.curve.reversals, y: r.curve.strain_plastic,
                    mode: 'lines', name: 'Plastic strain',
                    line: { color: '#f59e0b', width: 1.5, dash: 'dot' },
                  } as Plotly.Data,
                  {
                    x: [r.transition_reversals], y: [2 * r.transition_strain],
                    mode: 'markers', name: 'Transition life',
                    marker: { color: '#8b5cf6', size: 10, symbol: 'diamond' },
                  } as Plotly.Data,
                  ...(r.prediction ? [{
                    x: [r.prediction.reversals], y: [r.prediction.strain_amplitude],
                    mode: 'markers', name: 'Query point',
                    marker: { color: '#ef4444', size: 10, symbol: 'x' },
                  } as Plotly.Data] : []),
                ]}
                layout={{
                  xaxis: { title: { text: 'Reversals to Failure (2N)' }, type: 'log', gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Strain Amplitude' }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.7, y: 0.95, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'norris-landzberg': {
        const r = s.nlResult
        if (!r) return <EmptyState text="Set thermal cycling conditions and click Compute AF" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="Acceleration factor (AF)" value={r.acceleration_factor.toFixed(3)} accent />
              {r.cycles_field != null && (
                <Card label="Predicted field cycles" value={r.cycles_field.toExponential(3)} accent />
              )}
              <Card label="T max use (K)" value={r.T_max_use_K.toFixed(2)} />
              <Card label="T max test (K)" value={r.T_max_test_K.toFixed(2)} />
            </div>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <Card label="dT factor" value={r.factor_dT.toFixed(3)} />
              <Card label="Frequency factor" value={r.factor_frequency.toFixed(3)} />
              <Card label="Temperature factor" value={r.factor_temperature.toFixed(3)} />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
              <Plot
                data={[
                  {
                    x: ['dT factor', 'Frequency factor', 'Temperature factor', 'Total AF'],
                    y: [r.factor_dT, r.factor_frequency, r.factor_temperature, r.acceleration_factor],
                    type: 'bar',
                    marker: { color: ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6'] },
                  } as Plotly.Data,
                ]}
                layout={{
                  yaxis: { title: { text: 'Factor' }, gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 40, l: 60 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  showlegend: false,
                  shapes: [{
                    type: 'line', x0: -0.5, x1: 3.5, y0: 1, y1: 1,
                    line: { color: '#9ca3af', width: 1, dash: 'dash' },
                  }],
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'electromigration': {
        const r = s.emResult
        if (!r) return <EmptyState text="Set Black's equation parameters and click Compute MTTF" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-3 mb-6">
              <Card label={`MTTF (${r.time_unit})`} value={r.mttf.toExponential(3)} accent />
              <Card label="Temperature (K)" value={r.temperature_K.toFixed(2)} />
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
                <Plot
                  data={[
                    {
                      x: r.curve_temperature.temperature_C,
                      y: r.curve_temperature.mttf,
                      mode: 'lines', name: 'MTTF vs T',
                      line: { color: '#3b82f6', width: 2 },
                    } as Plotly.Data,
                    {
                      x: [parseFloat(s.emT)], y: [r.mttf],
                      mode: 'markers', name: 'Operating point',
                      marker: { color: '#ef4444', size: 10, symbol: 'diamond' },
                    } as Plotly.Data,
                  ]}
                  layout={{
                    xaxis: { title: { text: 'Temperature (deg C)' }, gridcolor: '#e5e7eb' },
                    yaxis: { title: { text: `MTTF (${r.time_unit})` }, type: 'log', gridcolor: '#e5e7eb' },
                    margin: { t: 20, r: 20, b: 50, l: 70 },
                    paper_bgcolor: 'white', plot_bgcolor: 'white',
                    legend: { x: 0.55, y: 0.95, font: { size: 10 } },
                    showlegend: true,
                  } as Partial<Plotly.Layout>}
                  config={{ responsive: true }}
                  style={{ width: '100%', height: '100%' }}
                  useResizeHandler
                />
              </div>
              <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
                <Plot
                  data={[
                    {
                      x: r.curve_current_density.J,
                      y: r.curve_current_density.mttf,
                      mode: 'lines', name: 'MTTF vs J',
                      line: { color: '#10b981', width: 2 },
                    } as Plotly.Data,
                    {
                      x: [parseFloat(s.emJ)], y: [r.mttf],
                      mode: 'markers', name: 'Operating point',
                      marker: { color: '#ef4444', size: 10, symbol: 'diamond' },
                    } as Plotly.Data,
                  ]}
                  layout={{
                    xaxis: { title: { text: 'Current Density J (A/cm^2)' }, type: 'log', gridcolor: '#e5e7eb' },
                    yaxis: { title: { text: `MTTF (${r.time_unit})` }, type: 'log', gridcolor: '#e5e7eb' },
                    margin: { t: 20, r: 20, b: 50, l: 70 },
                    paper_bgcolor: 'white', plot_bgcolor: 'white',
                    legend: { x: 0.55, y: 0.95, font: { size: 10 } },
                    showlegend: true,
                  } as Partial<Plotly.Layout>}
                  config={{ responsive: true }}
                  style={{ width: '100%', height: '100%' }}
                  useResizeHandler
                />
              </div>
            </div>
          </div>
        )
      }

      case 'peck': {
        const r = s.pkResult
        if (!r) return <EmptyState text="Set temperature-humidity parameters and click Compute TTF" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label={`TTF at test conditions (${r.time_unit})`} value={r.ttf_test.toExponential(3)} accent />
              <Card label="Test temperature (K)" value={r.temperature_K.toFixed(2)} />
              {r.acceleration_factor != null && (
                <Card label="Acceleration factor (AF)" value={r.acceleration_factor.toFixed(3)} accent />
              )}
              {r.ttf_use != null && (
                <Card label={`TTF at use conditions (${r.time_unit})`} value={r.ttf_use.toExponential(3)} accent />
              )}
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.curve.RH, y: r.curve.ttf,
                    mode: 'lines', name: 'TTF vs RH',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: [parseFloat(s.pkRH)], y: [r.ttf_test],
                    mode: 'markers', name: 'Test condition',
                    marker: { color: '#ef4444', size: 10, symbol: 'diamond' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Relative Humidity (%)' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: `Time to Failure (${r.time_unit})` }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.6, y: 0.95, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'arrhenius': {
        const r = s.arResult
        if (!r) return <EmptyState text="Set temperatures and click Compute AF" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            {r.temperature_response === 'higher_temperature_decreases_modeled_rate' && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-snug text-amber-800">
                Inverse-temperature model: the negative apparent Ea predicts greater damage at lower temperature.
                This test condition is <strong>{r.test_severity === 'more_damaging' ? 'more damaging' : r.test_severity === 'less_damaging' ? 'less damaging' : 'equivalent'}</strong> relative to use.
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="Acceleration factor (AF)" value={r.acceleration_factor.toFixed(3)} accent />
              {r.life_use != null && (
                <Card label={`Equivalent use life (${r.life_unit})`} value={r.life_use.toExponential(3)} accent />
              )}
              <Card label="T use (K)" value={r.T_use_K.toFixed(2)} />
              <Card label="T test (K)" value={r.T_test_K.toFixed(2)} />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.curve.T_test_C, y: r.curve.af,
                    mode: 'lines', name: 'AF vs test temperature',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: [parseFloat(s.arTTest)], y: [r.acceleration_factor],
                    mode: 'markers', name: 'Test condition',
                    marker: { color: '#ef4444', size: 10, symbol: 'diamond' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Test Temperature (deg C)' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Acceleration Factor' }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'eyring': {
        const r = s.eyResult
        if (!r) return <EmptyState text="Set temperatures and click Compute AF" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="Acceleration factor (AF)" value={r.acceleration_factor.toFixed(3)} accent />
              {r.life_use != null && (
                <Card label={`Equivalent use life (${r.life_unit})`} value={r.life_use.toExponential(3)} accent />
              )}
              <Card label="T use (K)" value={r.T_use_K.toFixed(2)} />
              <Card label="T test (K)" value={r.T_test_K.toFixed(2)} />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.curve.T_test_C, y: r.curve.af,
                    mode: 'lines', name: 'AF vs test temperature',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: [parseFloat(s.eyTTest)], y: [r.acceleration_factor],
                    mode: 'markers', name: 'Test condition',
                    marker: { color: '#ef4444', size: 10, symbol: 'diamond' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Test Temperature (deg C)' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Acceleration Factor' }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'hallberg-peck': {
        const r = s.hpResult
        if (!r) return <EmptyState text="Set T-H conditions and click Compute AF" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="Acceleration factor (AF)" value={r.acceleration_factor.toFixed(3)} accent />
              {r.life_use != null && (
                <Card label={`Equivalent use life (${r.life_unit})`} value={r.life_use.toExponential(3)} accent />
              )}
              <Card label="Humidity factor" value={r.factor_humidity.toFixed(3)} />
              <Card label="Temperature factor" value={r.factor_temperature.toFixed(3)} />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.curve.RH_use, y: r.curve.af,
                    mode: 'lines', name: 'AF vs use RH',
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: [parseFloat(s.hpRHUse)], y: [r.acceleration_factor],
                    mode: 'markers', name: 'Use condition',
                    marker: { color: '#ef4444', size: 10, symbol: 'diamond' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Use Relative Humidity (%)' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Acceleration Factor' }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.6, y: 0.95, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'tddb': {
        const r = s.tdResult
        if (!r) return <EmptyState text="Set field/temperature conditions and click Compute AF" />
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="Acceleration factor (AF)" value={r.acceleration_factor.toExponential(3)} accent />
              {r.life_use != null && (
                <Card label={`Equivalent use life (${r.life_unit})`} value={r.life_use.toExponential(3)} accent />
              )}
              <Card label="Field factor" value={r.factor_field.toExponential(3)} />
              <Card label="Temperature factor" value={r.factor_temperature.toFixed(3)} />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: r.curve.E_use, y: r.curve.af,
                    mode: 'lines', name: `AF vs use field (${r.model}-model)`,
                    line: { color: '#3b82f6', width: 2 },
                  } as Plotly.Data,
                  {
                    x: [parseFloat(s.tdEUse)], y: [r.acceleration_factor],
                    mode: 'markers', name: 'Use condition',
                    marker: { color: '#ef4444', size: 10, symbol: 'diamond' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Use Electric Field (MV/cm)' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Acceleration Factor' }, type: 'log', gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.5, y: 0.95, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }

      case 'mean-stress': {
        const r = s.msResult
        if (!r) return <EmptyState text="Set stresses and material strengths and click Compute Factor of Safety" />
        const nDisplay = isFinite(r.factor_of_safety) ? r.factor_of_safety.toFixed(3) : 'infinity'
        const methodLabel = r.method === 'goodman' ? 'Modified Goodman' : r.method === 'soderberg' ? 'Soderberg' : 'Gerber'
        return (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="Factor of safety (n)" value={nDisplay} accent />
              <div className={`rounded-lg border p-3 ${r.safe ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-xs text-gray-500">Status</p>
                <p className={`text-lg font-bold ${r.safe ? 'text-green-700' : 'text-red-700'}`}>
                  {r.safe ? 'SAFE' : 'FAILS'}
                </p>
              </div>
              <Card label="Criterion" value={methodLabel} />
              <Card label={`${r.strength_label} intercept (MPa)`} value={r.strength_intercept.toFixed(1)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              {r.model_comparison.map(item => (
                <Card key={item.method}
                  label={`${item.method[0].toUpperCase() + item.method.slice(1)} factor of safety`}
                  value={isFinite(item.factor_of_safety) ? item.factor_of_safety.toFixed(3) : 'infinity'}
                  accent={item.method === r.method} />
              ))}
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 420 }}>
              <Plot
                data={[
                  ...Object.entries(r.failure_lines).map(([name, line], i) => ({
                    x: line.sigma_m, y: line.sigma_a,
                    mode: 'lines', name: name[0].toUpperCase() + name.slice(1),
                    line: { color: ['#3b82f6', '#f59e0b', '#10b981'][i % 3], width: name === r.method ? 3 : 1.5 },
                  } as Plotly.Data)),
                  {
                    x: [r.operating_point.sigma_m], y: [r.operating_point.sigma_a],
                    mode: 'markers', name: 'Operating point',
                    marker: { color: r.safe ? '#10b981' : '#ef4444', size: 12, symbol: 'diamond' },
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: 'Mean Stress sigma_m (MPa)' }, gridcolor: '#e5e7eb', rangemode: 'tozero' },
                  yaxis: { title: { text: 'Alternating Stress sigma_a (MPa)' }, gridcolor: '#e5e7eb', rangemode: 'tozero' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.55, y: 0.95, font: { size: 10 } },
                  showlegend: true,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </div>
        )
      }
    }
  }

  return (
    <InfluenceScope resetKey={subTab} className="flex flex-col h-full">
      <FolioBar api={folios} />
      {/* Sub-tab selector grouped by failure-mechanism family */}
      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
            Failure-mechanism models
          </span>
          <button onClick={() => setWizardOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-violet-700 border border-violet-300 bg-violet-50 hover:bg-violet-100 rounded px-3 py-1.5 transition-colors">
            <Wand2 size={13} /> Model wizard — help me choose
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {SUB_TAB_GROUPS.map(grp => (
            <div key={grp.group} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
              {grp.group}
            </span>
            <div className="flex flex-wrap gap-1">
              {grp.tabs.map(tab => (
                <button key={tab.id}
                  onClick={() => { patch({ subTab: tab.id }); setError(null) }}
                  data-tab-id={tab.id}
                  className={`px-3 py-1.5 text-xs rounded font-medium border transition-colors ${
                    subTab === tab.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>
            </div>
          ))}
        </div>
      </div>
      <PoFWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onApply={model => {
          patch({ subTab: model })
          setError(null)
          setWizardOpen(false)
        }}
      />

      {/* Body: left panel + main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
          <div className="rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2 overflow-x-auto">
            <p className="text-[10px] font-medium text-violet-700 mb-1">{activeEquation.label}</p>
            <Latex block className="text-[13px] text-gray-800 min-w-max">{activeEquation.tex}</Latex>
          </div>
          <details className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <summary className="text-[11px] font-medium text-gray-700 cursor-pointer">Input uncertainty propagation</summary>
            <div className="mt-2 space-y-2">
              <InfluenceSource influence="pof.uncertainty.enabled"><label className="flex items-start gap-2 text-[11px] text-gray-700">
                <input type="checkbox" checked={s.pofUncertaintyEnabled}
                  onChange={e => patch({ pofUncertaintyEnabled: e.target.checked })} className="mt-0.5" />
                <span>Run independent-input Monte Carlo and plot a separate uncertainty interval.</span>
              </label></InfluenceSource>
              {s.pofUncertaintyEnabled && <>
                <div className="grid grid-cols-3 gap-2">
                  <InfluenceSource influence="pof.uncertainty.cv"><label className={labelCls}>Relative SD (%)</label><NumberField value={s.pofUncertaintyCv} onChange={v => patch({ pofUncertaintyCv: v })} min={0.01} max={500} step={1} className={fieldCls} /></InfluenceSource>
                  <InfluenceSource influence="pof.uncertainty.samples"><label className={labelCls}>Draws</label><NumberField value={s.pofUncertaintySamples} onChange={v => patch({ pofUncertaintySamples: v })} min={200} max={20000} step={100} className={fieldCls} /></InfluenceSource>
                  <InfluenceSource influence="pof.uncertainty.confidence"><label className={labelCls}>Confidence</label><ConfidenceInput value={s.pofUncertaintyConfidence} onChange={pofUncertaintyConfidence => patch({ pofUncertaintyConfidence })} className="w-full" /></InfluenceSource>
                </div>
                <div className="max-h-36 overflow-y-auto border border-gray-200 bg-white rounded p-2 space-y-1">
                  {uncertaintyOptions.length === 0
                    ? <p className="text-[10px] text-gray-400">Enter model inputs to expose selectable fields.</p>
                    : uncertaintyOptions.map(option => (
                      <InfluenceSource key={option.field} influence="pof.uncertainty.fields"><label className="flex items-center gap-1.5 text-[10px] text-gray-600">
                        <input type="checkbox" checked={selectedUncertaintyFields.includes(option.field)}
                          onChange={() => toggleUncertaintyField(option.field)} /> {option.label}
                      </label></InfluenceSource>
                    ))}
                </div>
                <p className="text-[10px] text-amber-700 leading-snug">Select populated inputs only. Positive inputs use mean-preserving lognormal draws; signed inputs use normal draws. Inputs are treated as independent.</p>
              </>}
            </div>
          </details>
          {renderLeftPanel()}
        </div>

        {/* Main content */}
        <div ref={resultsRef} className="flex-1 overflow-hidden flex flex-col">
          {currentResult && (
            <div className="flex justify-end px-6 pt-4">
              <ExportResultsButton getElement={() => resultsRef.current} baseName="physics_of_failure" />
            </div>
          )}
          {currentResult?.analysis && <PoFAnalysisSummary analysis={currentResult.analysis} />}
          {renderMainContent()}
        </div>
      </div>
    </InfluenceScope>
  )
}

// --- Small shared components ---

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-gray-400">
      <div className="text-center">
        <p className="text-lg font-medium">No results yet</p>
        <p className="text-sm mt-1">{text}</p>
      </div>
    </div>
  )
}

function PoFAnalysisSummary({ analysis }: { analysis: PoFAnalysisContract }) {
  const uncertaintyMetrics = Object.entries(analysis.uncertainty?.metrics ?? {})
  return (
    <InfluenceTarget influences={['pof.uncertainty.enabled', 'pof.uncertainty.cv', 'pof.uncertainty.samples', 'pof.uncertainty.confidence', 'pof.uncertainty.fields']} className="mx-6 mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`font-medium ${analysis.uncertainty ? 'text-blue-700' : 'text-gray-600'}`}>
          {analysis.uncertainty ? `Uncertainty propagated (${Math.round(analysis.uncertainty.confidence * 100)}% interval)` : 'Deterministic result only'}
        </span>
        <span className="text-gray-400">{analysis.validity.status.replace(/_/g, ' ')}</span>
      </div>
      {analysis.validity.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-amber-700 list-disc pl-4">
          {analysis.validity.warnings.map((warning, i) => <li key={i}>{warning}</li>)}
        </ul>
      )}
      {analysis.uncertainty && uncertaintyMetrics.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 mt-2">
          {uncertaintyMetrics.map(([name, summary]) => (
            <div key={name} className="rounded border border-blue-100 bg-blue-50 px-2 py-1">
              <p className="text-gray-500">{name.replace(/_/g, ' ')}</p>
              <p className="font-medium text-blue-800">{summary.median.toPrecision(4)} [{summary.lower.toPrecision(4)}, {summary.upper.toPrecision(4)}]</p>
              <UncertaintyHistogram
                samples={summary.plot_samples}
                deterministic={analysis.deterministic[name]}
                lower={summary.lower}
                upper={summary.upper}
                label={name.replace(/_/g, ' ')}
              />
            </div>
          ))}
        </div>
      )}
      <details className="mt-2 text-gray-500">
        <summary className="cursor-pointer">Units and validity assumptions</summary>
        <div className="mt-1 grid md:grid-cols-2 gap-3">
          <ul className="list-disc pl-4">{Object.entries(analysis.units).map(([name, unit]) => <li key={name}>{name.replace(/_/g, ' ')}: {unit}</li>)}</ul>
          <ul className="list-disc pl-4">{analysis.validity.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      </details>
    </InfluenceTarget>
  )
}

function UncertaintyHistogram({
  samples, deterministic, lower, upper, label,
}: {
  samples: number[]; deterministic?: number; lower: number; upper: number; label: string
}) {
  const finite = samples.filter(Number.isFinite)
  if (finite.length < 2) return null
  const candidates = [Math.min(...finite), Math.max(...finite), lower, upper]
  if (deterministic != null && Number.isFinite(deterministic)) candidates.push(deterministic)
  let min = Math.min(...candidates)
  let max = Math.max(...candidates)
  if (min === max) { min -= Math.abs(min || 1) * 0.05; max += Math.abs(max || 1) * 0.05 }
  const bins = 24
  const counts = Array.from({ length: bins }, () => 0)
  finite.forEach(value => {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - min) / (max - min) * bins)))
    counts[index] += 1
  })
  const peak = Math.max(...counts, 1)
  const x = (value: number) => 4 + (value - min) / (max - min) * 232
  return (
    <svg viewBox="0 0 240 54" className="mt-1 h-14 w-full" role="img"
      aria-label={`Monte Carlo distribution for ${label}`}>
      <title>{`${label}: propagated Monte Carlo draws; shaded region is the selected interval and the purple line is the deterministic result.`}</title>
      <rect x={x(lower)} y="3" width={Math.max(1, x(upper) - x(lower))} height="46" fill="#dbeafe" opacity="0.75" />
      {counts.map((count, index) => {
        const height = count / peak * 40
        return <rect key={index} x={4 + index * (232 / bins)} y={49 - height}
          width={Math.max(1, 232 / bins - 0.7)} height={height} fill="#60a5fa" opacity="0.8" />
      })}
      <line x1="4" x2="236" y1="49.5" y2="49.5" stroke="#94a3b8" strokeWidth="0.8" />
      {deterministic != null && Number.isFinite(deterministic) && (
        <line x1={x(deterministic)} x2={x(deterministic)} y1="2" y2="50" stroke="#7c3aed" strokeWidth="2" />
      )}
    </svg>
  )
}
