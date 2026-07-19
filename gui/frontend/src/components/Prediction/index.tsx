import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Plot from '../shared/ExportablePlot'
import {
  Play, Plus, Trash2, Upload, Download, X, ChevronRight, ChevronDown,
  FolderOpen, Folder, Box, Cpu, Triangle, CircuitBoard, Zap, Lightbulb,
  Battery, Magnet, ToggleRight, ToggleLeft, Plug, Cable, Fan, Diamond,
  Filter, RectangleHorizontal, StickyNote, Gauge, Shield, MonitorSpeaker,
  Activity, Disc, AlertTriangle, Clock, Map as MapIcon, Search,
} from 'lucide-react'
import {
  predictFailureRate, EquationSymbolBinding, PartsCountCatalogEntry, PredictionPart, PredictionParamValue, PredictionResult, PredictionResponse,
  MethodologyDisclosure,
  analyzeDerating, DeratingResponse, DeratingPartResult, getDeratingStandards, DeratingStandard, DeratingProfileSchema, CustomDeratingRule,
  predictMissionProfile, MissionPhaseInput, MissionProfileResponse,
  getMissionProfiles, predictMultiStandard, getPredictionStandards, getPartsCountCatalog,
  getPredictionOptions,
} from '../../api/client'
import { useFolioState } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import NumberField from '../shared/NumberField'
import Latex, { formulaToLatex } from '../shared/Latex'
import { paletteGroupsFor, PALETTE_DND_TYPE, PaletteItem } from './palette'
import PartRow from './partsTable'
import { NO_ENV_CATEGORIES, VITA_CATEGORIES, VITA_ONLY_CATEGORIES } from './constants'
import { useHelpTopic } from '../help/context'

const ENVIRONMENTS = [
  { code: 'GB', label: 'GB — Ground, Benign' },
  { code: 'GF', label: 'GF — Ground, Fixed' },
  { code: 'GM', label: 'GM — Ground, Mobile' },
  { code: 'NS', label: 'NS — Naval, Sheltered' },
  { code: 'NU', label: 'NU — Naval, Unsheltered' },
  { code: 'AIC', label: 'AIC — Airborne, Inhabited Cargo' },
  { code: 'AIF', label: 'AIF — Airborne, Inhabited Fighter' },
  { code: 'AUC', label: 'AUC — Airborne, Uninhabited Cargo' },
  { code: 'AUF', label: 'AUF — Airborne, Uninhabited Fighter' },
  { code: 'ARW', label: 'ARW — Airborne, Rotary Wing' },
  { code: 'SF', label: 'SF — Space, Flight' },
  { code: 'MF', label: 'MF — Missile, Flight' },
  { code: 'ML', label: 'ML — Missile, Launch' },
  { code: 'CL', label: 'CL — Cannon, Launch' },
]

interface Field {
  key: string
  label: string
  type: 'number' | 'select' | 'text'
  options?: string[]
  default: string | number
  // Bounded increments for numeric fields (#2). Omitted -> NumberField auto-steps.
  step?: number
  min?: number
  max?: number
  optional?: boolean
  placeholder?: string
  help?: string
}

const USER_DEFINED_FIELDS: Record<string, Field[]> = {
  custom: [
    { key: 'model', label: 'Failure model', type: 'select', options: ['exponential', 'weibull'], default: 'exponential' },
    { key: 'failure_rate', label: 'λ (FPMH, exponential)', type: 'number', default: 0.1, step: 0.01, min: 0 },
    { key: 'eta', label: 'Weibull η (hours)', type: 'number', default: 50000, step: 1000, min: 0 },
    { key: 'beta', label: 'Weibull β', type: 'number', default: 2, step: 0.1, min: 0 },
    { key: 'eval_time', label: 'Weibull evaluation time (hours)', type: 'number', default: 8760, step: 100, min: 0 },
  ],
  generic: [
    { key: 'failure_rate', label: 'Failure rate (FPMH)', type: 'number', default: 0.1, step: 0.01, min: 0 },
  ],
}

// Exact MIL-HDBK-217F Notice 2 model surface.  The original prediction UI
// grouped unrelated handbook clauses behind synthetic categories (for
// example one "laser" and one "rotating" model) and exposed parameters that
// do not occur in those clauses.  Keep the clause-level inputs explicit so a
// saved line item is unambiguous and auditable against its cited equation.
const MIL_DISCRETE_QUALITY = ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic']
const MIL_HF_DIODE_QUALITY = ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic']
const MIL_RF_QUALITY = ['JANTXV', 'JANTX', 'JAN', 'lower']
const MIL_MICRO_QUALITY = ['S', 'B', 'B-1', 'commercial']
const MIL_MICRO_QUALITY_LABELS: Record<string, string> = {
  S: 'S — 217F Class-S family (πQ = 0.25)',
  B: 'B — 217F Class-B family (πQ = 1)',
  'B-1': 'B-1 — §1.2.1-compliant non-JAN screening bucket (πQ = 2)',
  commercial: 'Commercial / unknown screening (πQ = 10)',
}
const MIL_MICRO_QUALITY_CATEGORIES = new Set([
  'microcircuit', 'vhsic_microcircuit', 'gaas_microcircuit',
  'hybrid_microcircuit', 'bubble_memory', 'detailed_cmos',
])
const BOOLEAN_OPTIONS = ['true', 'false']

const formatDeratingValue = (
  value: number | boolean | string | null | undefined,
  unit: string,
): string => {
  if (value == null) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return `${value}${unit ? ` ${unit}` : ''}`
  if (unit === 'ratio') return `${(value * 100).toPrecision(4)}%`
  const rendered = Number.isInteger(value) ? String(value) : value.toPrecision(6)
  return `${rendered}${unit === '°C' ? '°C' : unit ? ` ${unit}` : ''}`
}

const normalizePartNumber = (value: string | null | undefined) =>
  value?.trim().toLocaleUpperCase() ?? ''

/** Resolve profile inputs from another line item with the same part number.
 *  Local values win, so a component can still override a shared input. */
const effectiveDeratingParams = (
  parts: PredictionPart[],
  index: number,
  profile: string,
): Record<string, unknown> => {
  const part = parts[index]
  if (!part) return {}
  const own = part.derating_params?.profile === profile ? part.derating_params : {}
  const partNumber = normalizePartNumber(part.part_number)
  if (!partNumber) return part.derating_params ?? {}
  const source = parts.find((candidate, candidateIndex) =>
    candidateIndex !== index
    && candidate.category === part.category
    && normalizePartNumber(candidate.part_number) === partNumber
    && candidate.derating_params?.profile === profile
    && (!own.family || candidate.derating_params?.family === own.family)
    && Object.keys(candidate.derating_params).some(key => key !== 'profile'))
  if (!source?.derating_params) return part.derating_params ?? {}
  return { ...source.derating_params, ...own, profile }
}

interface AutomaticDeratingResolution {
  family: string
  familyAutomaticallyMatched: boolean
  values: Record<string, unknown>
  inheritedFields: Set<string>
}

/** Mirror the declarative backend resolver for immediate, pre-request UI feedback. */
const resolveAutomaticDeratingInputs = (
  schema: DeratingProfileSchema | null | undefined,
  part: PredictionPart | null,
  familyOverride?: string,
): AutomaticDeratingResolution | null => {
  if (!schema?.automatic_mapping || !part) return null
  const matches = schema.automatic_mapping.family_rules.filter(rule => {
    if (rule.category !== part.category) return false
    return Object.entries(rule.when ?? {}).every(([key, accepted]) =>
      accepted.includes(part.params[key] as string | number | boolean))
  })
  const families = [...new Set(matches.map(rule => rule.family))]
  const automaticFamily = families.length === 1 ? families[0] : undefined
  const family = familyOverride || automaticFamily
  if (!family) return null
  const definition = schema.families.find(candidate => candidate.key === family)
  if (!definition) return null
  const fields = new Map(definition.fields.map(field => [field.key, field]))
  const values: Record<string, unknown> = {}
  const inheritedFields = new Set<string>()

  for (const rule of matches.filter(candidate => candidate.family === family)) {
    for (const [key, value] of Object.entries(rule.values ?? {})) {
      if (!fields.has(key)) continue
      values[key] = value
      inheritedFields.add(key)
    }
  }
  for (const field of definition.fields) {
    const value = part.params[field.key]
    if (value == null || (typeof value === 'string' && value.trim() === '')) continue
    if (field.options && !field.options.includes(String(value))) continue
    values[field.key] = value
    inheritedFields.add(field.key)
  }
  const fieldRules = schema.automatic_mapping.field_rules[family] ?? {}
  for (const [target, rule] of Object.entries(fieldRules)) {
    if (!fields.has(target) || rule.keys.some(key => part.params[key] == null)) continue
    const inputs = rule.keys.map(key => part.params[key])
    let value: unknown
    if (rule.transform === 'product') {
      const numbers = inputs.map(Number)
      if (numbers.some(item => !Number.isFinite(item))) continue
      value = numbers.reduce((product, item) => product * item, 1)
    } else if (rule.transform === 'ratio_to_percent') {
      const number = Number(inputs[0])
      if (!Number.isFinite(number)) continue
      value = number * 100
    } else {
      value = inputs[0]
    }
    if (rule.value_map) {
      const mapped = rule.value_map[String(value)]
      if (mapped === undefined) continue
      value = mapped
    }
    const targetField = fields.get(target)
    if (targetField?.options && !targetField.options.includes(String(value))) continue
    values[target] = value
    inheritedFields.add(target)
  }
  return {
    family,
    familyAutomaticallyMatched: !familyOverride && family === automaticFamily,
    values,
    inheritedFields,
  }
}

// Handbook style designators remain visible for traceability, but a code such
// as "RW" is not meaningful on its own.  These descriptions are the component
// descriptions printed in MIL-HDBK-217F Notice 2 Tables 9.1 and 10.1.
const RESISTOR_STYLE_LABELS: Record<string, string> = {
  RC: 'Fixed composition, insulated',
  RCR: 'Fixed composition, insulated — established reliability',
  RL: 'Fixed film, insulated',
  RLR: 'Fixed film, insulated — established reliability',
  RN: 'Fixed film — established reliability / high stability',
  RNR: 'Fixed film — established reliability',
  RM: 'Fixed film chip — established reliability',
  RD: 'Fixed film, power type',
  RZ: 'Fixed film resistor network',
  RB: 'Fixed wirewound, accurate',
  RBR: 'Fixed wirewound, accurate — established reliability',
  RW: 'Fixed wirewound, power type',
  RWR: 'Fixed wirewound, power type — established reliability',
  RE: 'Fixed wirewound, chassis-mounted power type',
  RER: 'Fixed wirewound, chassis-mounted power type — established reliability',
  RTH: 'Insulated thermistor',
  RT: 'Variable wirewound, lead-screw actuated',
  RTR: 'Variable wirewound, lead-screw actuated — established reliability',
  RR: 'Variable wirewound, precision',
  RA: 'Variable wirewound, low-temperature',
  RK: 'Variable wirewound, semi-precision',
  RP: 'Variable wirewound, power type',
  RJ: 'Variable non-wirewound',
  RJR: 'Variable non-wirewound — established reliability',
  RV: 'Variable composition',
  RQ: 'Variable non-wirewound, precision',
  RVC: 'Variable non-wirewound',
}

const CAPACITOR_STYLE_LABELS: Record<string, string> = {
  CP: 'Fixed paper dielectric, hermetically sealed',
  CA: 'Paper-dielectric interference-suppression / bypass',
  CZ: 'Paper-dielectric feed-through',
  CZR: 'Paper-dielectric feed-through — established reliability',
  CQ: 'Fixed plastic or paper-plastic dielectric, hermetic',
  CQR: 'Fixed plastic or paper-plastic dielectric — established reliability',
  CH: 'Fixed metallized paper or plastic-film dielectric',
  CHR: 'Fixed metallized film — established reliability',
  CFR: 'Fixed plastic or metallized-plastic film, nonmetal case',
  CRH: 'Fixed supermetallized plastic film, hermetic',
  CM: 'Fixed mica dielectric',
  CMR: 'Fixed mica dielectric — established reliability',
  CB: 'Fixed mica dielectric, button style',
  CY: 'Fixed glass dielectric',
  CYR: 'Fixed glass dielectric — established reliability',
  CK: 'Fixed ceramic, general purpose',
  CKR: 'Fixed ceramic, general purpose — established reliability',
  CC: 'Fixed ceramic, temperature compensating',
  CCR: 'Fixed ceramic, temperature compensating — established reliability',
  CDR: 'Fixed multilayer ceramic chip — established reliability',
  PS: 'Horizontally stacked ceramic chip — A/V51.1 mapping',
  CSR: 'Fixed solid-tantalum electrolytic — established reliability',
  CWR: 'Fixed tantalum electrolytic chip — established reliability',
  CL: 'Fixed nonsolid-tantalum electrolytic',
  CLR: 'Fixed nonsolid-tantalum electrolytic — established reliability',
  CRL: 'Fixed nonsolid-tantalum electrolytic, tantalum cathode',
  CU: 'Fixed aluminum-oxide electrolytic',
  CUR: 'Fixed aluminum-oxide electrolytic — established reliability',
  CE: 'Fixed dry aluminum electrolytic, polarized',
  CV: 'Variable ceramic-dielectric trimmer',
  PC: 'Variable piston-type tubular trimmer',
  CT: 'Variable air-dielectric trimmer',
  CG: 'Fixed or variable vacuum dielectric',
}

const OPTION_ACRONYMS: Record<string, string> = {
  mos: 'MOS', pla: 'PLA/PAL', eeprom: 'EEPROM', eaprom: 'EAPROM',
  dram: 'DRAM', sram: 'SRAM', ccd: 'CCD', sdram: 'SDRAM', nvsram: 'NVSRAM',
  dip: 'DIP', pga: 'PGA', smt: 'SMT', bga: 'BGA', qfp: 'QFP', plcc: 'PLCC',
  qml: 'QML', qpl: 'QPL', gb: 'GB',
}

const humanizeOption = (option: string) => option
  .split('_')
  .map(word => OPTION_ACRONYMS[word.toLowerCase()] ??
    (word ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
  .join(' ')

const PARTS_COUNT_GROUP_BY_FAMILY: Record<string, string> = {
  microcircuit: 'Microcircuits',
  non_rf_semiconductor: 'Discrete semiconductors',
  hf_diode: 'Discrete semiconductors',
  rf_transistor: 'Discrete semiconductors',
  laser_diode: 'Discrete semiconductors',
  resistor: 'Passive components',
  capacitor: 'Passive components',
  inductive: 'Passive components',
  crystal: 'Passive components',
  filter: 'Passive components',
  rotating: 'Electromechanical components',
  mechanical_relay: 'Electromechanical components',
  solid_state_relay: 'Electromechanical components',
  switch: 'Electromechanical components',
  circuit_breaker: 'Electromechanical components',
  meter: 'Electromechanical components',
  lamp: 'Electromechanical components',
  connector: 'Interconnect and assemblies',
  socket: 'Interconnect and assemblies',
  pth: 'Interconnect and assemblies',
  smt: 'Interconnect and assemblies',
  connection: 'Interconnect and assemblies',
  fuse: 'Other components',
}

const PARTS_COUNT_GROUP_ORDER = [
  'Microcircuits', 'Discrete semiconductors', 'Passive components',
  'Electromechanical components', 'Interconnect and assemblies', 'Other components',
]

const MIL_NOTICE2_FIELDS: Record<string, Field[]> = {
  microcircuit: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['digital', 'linear', 'pla', 'microprocessor', 'memory'], default: 'digital' },
    { key: 'technology', label: 'Technology', type: 'select', options: ['mos', 'bipolar'], default: 'mos' },
    { key: 'complexity', label: 'Gates, transistors, data bits, or memory bits', type: 'number', default: 1000, step: 1, min: 1 },
    { key: 'pins', label: 'Package pins', type: 'number', default: 16, step: 1, min: 1 },
    { key: 'package', label: 'Package', type: 'select', options: ['hermetic_dip', 'hermetic_pga', 'hermetic_smt', 'glass_dip', 'flatpack', 'can', 'nonhermetic', 'nonhermetic_dip', 'nonhermetic_pga', 'nonhermetic_smt'], default: 'nonhermetic' },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_MICRO_QUALITY, default: 'commercial' },
    { key: 'years_in_production', label: 'Years in production', type: 'number', default: 2, step: 0.1, min: 0 },
    { key: 'memory_type', label: 'Memory type (memory devices)', type: 'select', options: ['rom', 'prom', 'uvprom', 'eeprom', 'eaprom', 'dram', 'sram', 'ccd', 'sdram', 'nvsram', 'flash'], default: 'rom', help: 'CCD uses the NMOS DRAM mapping documented by RADC-TR-80-237; soft errors are excluded. SDRAM, NVSRAM, and Flash are A/V51.1 mappings to DRAM, SRAM, and Flotox EEPROM.' },
    { key: 'eeprom_technology', label: 'EEPROM technology', type: 'select', options: ['flotox', 'textured_poly'], default: 'flotox' },
    { key: 'programming_cycles', label: 'Lifetime programming cycles', type: 'number', default: 0, step: 100, min: 0, max: 500000 },
    { key: 'ecc', label: 'On-chip error correction', type: 'select', options: ['none', 'hamming', 'redundant_cell'], default: 'none' },
    { key: 'system_lifetime_hours', label: 'System operating life (hours)', type: 'number', default: 10000, step: 1000, min: 1 },
    { key: 'c1_override', label: 'C₁ override (optional)', type: 'number', default: '', step: 0.001, min: 0.000001, optional: true, placeholder: 'Use MIL/A/V table', help: 'For complexity beyond the last printed band, enter a justified C₁ and disclose its derivation per A/V51.1 Rule 2.1.2-2.' },
    { key: 'feature_size_nm', label: 'Feature size (nm, optional)', type: 'number', default: '', step: 1, min: 0.000001, optional: true, placeholder: 'For wearout warning', help: 'Below 130 nm, A/V51.1 recommends separate VITA 51.2/equivalent EM, TDDB, HCI, and NBTI wearout models.' },
    { key: 'temperature_rise_used', label: 'Junction temperature uses a rise calculation', type: 'select', options: BOOLEAN_OPTIONS, default: 'false' },
    { key: 'temperature_rise_source', label: 'Temperature-rise derivation source', type: 'text', default: '', optional: true, placeholder: 'Thermal analysis, datasheet θJC × power, …', help: 'Required by A/V51.1 Rule 2.1.2-4 when a temperature-rise calculation is used.' },
    { key: 'manufacturer_rate_fpmh', label: 'Digital-logic manufacturer rate (FPMH, optional)', type: 'number', default: '', step: 0.000001, min: 0, optional: true, placeholder: 'Use Section 5 prediction', help: 'For digital logic with A/V51.1 active, replaces the Section 5 rate and applies the Permission 2.3.4-1 temperature/environment conversion. Use the parts-count Appendix H method for other device types.' },
    { key: 'manufacturer_test_junction_temperature_c', label: 'Manufacturer test junction temperature (°C)', type: 'number', default: 55, step: 1, min: -65, max: 250 },
    { key: 'manufacturer_test_environment', label: 'Manufacturer test environment', type: 'select', options: ['GB'], default: 'GB', help: 'Permission 2.3.4-1 defines this direct conversion from Ground Benign test data.' },
  ],
  vhsic_microcircuit: [
    { key: 'part_type', label: 'Part type', type: 'select', options: ['logic_custom', 'gate_array_memory'], default: 'logic_custom' },
    { key: 'manufacturing_process', label: 'Manufacturing process', type: 'select', options: ['qml_qpl', 'non_qml'], default: 'non_qml' },
    { key: 'die_area_cm2', label: 'Die area (cm²)', type: 'number', default: 0.21, step: 0.01, min: 0.000001 },
    { key: 'feature_size_microns', label: 'Feature size (µm)', type: 'number', default: 2, step: 0.1, min: 0.000001 },
    { key: 'pins', label: 'Package pins', type: 'number', default: 64, step: 1, min: 1 },
    { key: 'package_type', label: 'Package type', type: 'select', options: ['dip', 'pin_grid_array', 'chip_carrier'], default: 'dip' },
    { key: 'hermetic', label: 'Hermetic package', type: 'select', options: BOOLEAN_OPTIONS, default: 'true' },
    { key: 'esd_threshold_volts', label: 'ESD susceptibility threshold (V; 0 if unknown)', type: 'number', default: 0, step: 100, min: 0 },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_MICRO_QUALITY, default: 'commercial' },
  ],
  gaas_microcircuit: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['mmic', 'digital'], default: 'mmic' },
    { key: 'active_elements', label: 'Active elements', type: 'number', default: 100, step: 1, min: 1, max: 10000 },
    { key: 'application', label: 'MMIC application', type: 'select', options: ['low_noise', 'low_power', 'driver', 'high_power', 'unknown'], default: 'low_noise' },
    { key: 'pins', label: 'Package pins', type: 'number', default: 16, step: 1, min: 1 },
    { key: 'package', label: 'Package', type: 'select', options: ['hermetic_dip', 'hermetic_pga', 'hermetic_smt', 'glass_dip', 'flatpack', 'can', 'nonhermetic', 'nonhermetic_dip', 'nonhermetic_pga', 'nonhermetic_smt'], default: 'hermetic_dip' },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 100, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_MICRO_QUALITY, default: 'commercial' },
    { key: 'years_in_production', label: 'Years in production', type: 'number', default: 2, step: 0.1, min: 0 },
  ],
  hybrid_microcircuit: [
    { key: 'sum_Ni_lambda_ci', label: 'Σ(Nc λc), component contribution (FPMH)', type: 'number', default: 0.01, step: 0.001, min: 0 },
    { key: 'function', label: 'Hybrid function', type: 'select', options: ['digital', 'video', 'microwave', 'linear', 'power'], default: 'digital' },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_MICRO_QUALITY, default: 'commercial' },
    { key: 'years_in_production', label: 'Years in production', type: 'number', default: 2, step: 0.1, min: 0 },
  ],
  saw_device: [
    { key: 'screening', label: 'Screening level', type: 'select', options: ['commercial', 'ten_temperature_cycles'], default: 'commercial' },
  ],
  bubble_memory: [
    { key: 'dissipative_elements', label: 'Dissipative elements per chip, N₁', type: 'number', default: 100, step: 1, min: 1, max: 1000 },
    { key: 'memory_bits', label: 'Memory bits, N₂', type: 'number', default: 1024, step: 1, min: 1, max: 9000000 },
    { key: 'chips_per_package', label: 'Bubble chips per package, N꜀', type: 'number', default: 1, step: 1, min: 1 },
    { key: 'data_rate_ratio', label: 'Average/rated data-rate ratio, D', type: 'number', default: 0.03, step: 0.01, min: 0, max: 1 },
    { key: 'reads_per_write', label: 'Reads per write, R/W', type: 'number', default: 2154, step: 1, min: 0.000001 },
    { key: 'seed_generator', label: 'Seed generator', type: 'select', options: BOOLEAN_OPTIONS, default: 'false' },
    { key: 'T_junction_1', label: 'Control/detection junction temperature (°C)', type: 'number', default: 50, step: 1, min: 25, max: 175 },
    { key: 'T_junction_2', label: 'Storage junction temperature (°C)', type: 'number', default: 50, step: 1, min: 25, max: 175 },
    { key: 'pins', label: 'Package pins', type: 'number', default: 16, step: 1, min: 1 },
    { key: 'package', label: 'Package', type: 'select', options: ['hermetic_dip', 'hermetic_pga', 'hermetic_smt', 'glass_dip', 'flatpack', 'can', 'nonhermetic', 'nonhermetic_dip', 'nonhermetic_pga', 'nonhermetic_smt'], default: 'nonhermetic' },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_MICRO_QUALITY, default: 'commercial' },
    { key: 'years_in_production', label: 'Years in production', type: 'number', default: 2, step: 0.1, min: 0 },
  ],
  diode: [
    { key: 'diode_type', label: 'Diode type', type: 'select', options: ['general_purpose_analog', 'switching', 'fast_recovery', 'power_rectifier', 'schottky', 'high_voltage_stack', 'transient_suppressor', 'current_regulator', 'voltage_regulator', 'voltage_reference'], default: 'general_purpose_analog' },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'voltage_stress', label: 'Voltage stress ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'contact', label: 'Contact construction', type: 'select', options: ['bonded', 'spring'], default: 'bonded' },
    { key: 'junctions', label: 'Series junctions (high-voltage stack)', type: 'number', default: 1, step: 1, min: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_DISCRETE_QUALITY, default: 'plastic' },
  ],
  hf_diode: [
    { key: 'diode_type', label: 'Diode type', type: 'select', options: ['impatt', 'gunn', 'tunnel', 'back', 'pin', 'schottky', 'point_contact', 'varactor', 'step_recovery'], default: 'varactor' },
    { key: 'application', label: 'Application', type: 'select', options: ['other', 'voltage_control', 'multiplier', 'oscillator', 'mixer', 'detector', 'amplifier', 'switch'], default: 'other' },
    { key: 'rated_power', label: 'Rated power (W)', type: 'number', default: 0.5, step: 0.1, min: 0.000001 },
    { key: 'frequency_ghz', label: 'Operating frequency (GHz)', type: 'number', default: 1, step: 0.1, min: 0.000001, max: 35 },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality (plastic is unavailable for Schottky/point-contact)', type: 'select', options: MIL_HF_DIODE_QUALITY, default: 'lower' },
  ],
  bjt: [
    { key: 'application', label: 'Application', type: 'select', options: ['switching', 'linear'], default: 'switching' },
    { key: 'rated_power', label: 'Rated power (W)', type: 'number', default: 0.5, step: 0.1, min: 0.000001 },
    { key: 'frequency_mhz', label: 'Operating frequency (MHz; ≤200)', type: 'number', default: 100, step: 1, min: 0.000001, max: 200 },
    { key: 'voltage_stress', label: 'Voltage stress ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_DISCRETE_QUALITY, default: 'plastic' },
  ],
  fet: [
    { key: 'fet_type', label: 'FET type', type: 'select', options: ['mosfet', 'jfet'], default: 'mosfet' },
    { key: 'application', label: 'Application', type: 'select', options: ['switching', 'linear', 'power'], default: 'switching' },
    { key: 'rated_power', label: 'Rated power (W; power application requires ≥2 W)', type: 'number', default: 0.5, step: 0.1, min: 0.000001 },
    { key: 'frequency_mhz', label: 'Operating frequency (MHz; ≤400)', type: 'number', default: 100, step: 1, min: 0.000001, max: 400 },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_DISCRETE_QUALITY, default: 'plastic' },
  ],
  unijunction: [
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_DISCRETE_QUALITY, default: 'plastic' },
  ],
  hf_low_noise_bjt: [
    { key: 'rated_power', label: 'Rated power (W; <1 W)', type: 'number', default: 0.5, step: 0.1, min: 0.000001, max: 0.999999 },
    { key: 'frequency_mhz', label: 'Operating frequency (MHz; >200)', type: 'number', default: 1000, step: 1, min: 200.000001 },
    { key: 'voltage_stress', label: 'Voltage stress ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_RF_QUALITY, default: 'lower' },
  ],
  hf_power_bjt: [
    { key: 'frequency_ghz', label: 'Frequency (GHz; ≤5)', type: 'number', default: 1, step: 0.1, min: 0.000001, max: 5 },
    { key: 'rated_power_watts', label: 'Average output power (W; table limits vary with frequency)', type: 'number', default: 10, step: 1, min: 1, max: 600 },
    { key: 'voltage_stress', label: 'Voltage stress ratio', type: 'number', default: 0.4, step: 0.01, min: 0, max: 0.55 },
    { key: 'metallization', label: 'Metallization', type: 'select', options: ['gold', 'aluminum'], default: 'gold' },
    { key: 'operation', label: 'Operation', type: 'select', options: ['continuous', 'pulsed'], default: 'continuous' },
    { key: 'duty_cycle', label: 'Duty cycle', type: 'number', default: 0.1, step: 0.01, min: 0, max: 1 },
    { key: 'matching', label: 'Matching', type: 'select', options: ['input_output', 'input', 'none'], default: 'input_output' },
    { key: 'T_junction', label: 'Peak junction temperature (°C)', type: 'number', default: 100, step: 1, min: 100, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_RF_QUALITY, default: 'lower' },
  ],
  gaas_fet: [
    { key: 'frequency_ghz', label: 'Frequency (GHz)', type: 'number', default: 5, step: 0.1, min: 1, max: 10 },
    { key: 'rated_power_watts', label: 'Rated power (W)', type: 'number', default: 0.05, step: 0.01, min: 0.000001, max: 6 },
    { key: 'operation', label: 'Operation', type: 'select', options: ['low_power', 'pulsed', 'continuous'], default: 'low_power' },
    { key: 'matching', label: 'Matching', type: 'select', options: ['input_output', 'input', 'none'], default: 'input_output' },
    { key: 'channel_temperature_c', label: 'Channel temperature, Tᴄ (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_RF_QUALITY, default: 'lower' },
  ],
  hf_silicon_fet: [
    { key: 'fet_type', label: 'FET type', type: 'select', options: ['mosfet', 'jfet'], default: 'mosfet' },
    { key: 'average_power_watts', label: 'Average power (W; <0.3 W)', type: 'number', default: 0.1, step: 0.01, min: 0.000001, max: 0.299999 },
    { key: 'frequency_mhz', label: 'Operating frequency (MHz; >400)', type: 'number', default: 1000, step: 1, min: 400.000001 },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_RF_QUALITY, default: 'lower' },
  ],
  thyristor: [
    { key: 'rated_current', label: 'Rated forward current (A)', type: 'number', default: 1, step: 0.1, min: 0.000001 },
    { key: 'voltage_stress', label: 'Voltage stress ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_DISCRETE_QUALITY, default: 'plastic' },
  ],
  optoelectronic: [
    { key: 'device', label: 'Device', type: 'select', options: ['phototransistor', 'photodiode', 'ir_led', 'led', 'optical_isolator', 'segment_display', 'alphanumeric_display', 'diode_array_display'], default: 'led' },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'detector', label: 'Isolator detector', type: 'select', options: ['photodiode', 'phototransistor', 'darlington', 'lsr'], default: 'phototransistor' },
    { key: 'channels', label: 'Isolator channels', type: 'select', options: ['single', 'dual'], default: 'single' },
    { key: 'display_characters', label: 'Display characters', type: 'number', default: 1, step: 1, min: 1 },
    { key: 'display_logic_chip', label: 'Display contains logic chip', type: 'select', options: BOOLEAN_OPTIONS, default: 'false' },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_DISCRETE_QUALITY, default: 'plastic' },
  ],
  laser_diode: [
    { key: 'material', label: 'Material', type: 'select', options: ['gaas_algaas', 'ingaas_ingaasp'], default: 'gaas_algaas' },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 50, step: 1, min: 25, max: 75 },
    { key: 'package', label: 'Package/facet protection', type: 'select', options: ['hermetic', 'nonhermetic_coated', 'nonhermetic_uncoated'], default: 'hermetic' },
    { key: 'forward_peak_current_amps', label: 'Forward peak current (A)', type: 'number', default: 1, step: 0.05, min: 0.000001, max: 25 },
    { key: 'optical_flux_density_mw_per_cm2', label: 'Optical flux density (MW/cm²; <3)', type: 'number', default: 1, step: 0.1, min: 0.000001, max: 2.999999 },
    { key: 'operation', label: 'Operation', type: 'select', options: ['continuous', 'pulsed'], default: 'continuous' },
    { key: 'duty_cycle', label: 'Duty cycle', type: 'number', default: 1, step: 0.05, min: 0, max: 1 },
    { key: 'output_power_ratio', label: 'Required/rated optical power', type: 'number', default: 0.5, step: 0.05, min: 0, max: 0.95 },
  ],
  electron_tube: [
    { key: 'tube_type', label: 'Tube type or listed device', type: 'select', options: [
      'receiver_triode_tetrode_pentode', 'power_rectifier', 'crt', 'thyratron', 'cfa_qk681', 'cfa_sfd261',
      'pulsed_gridded_2041', 'pulsed_gridded_6952', 'pulsed_gridded_7835', 'transmitting_triode_within_limits',
      'transmitting_tetrode_pentode_within_limits', 'transmitting_limits_exceeded', 'vidicon_antimony_trisulfide',
      'vidicon_silicon_diode_array', 'twystron_va144', 'twystron_va145e', 'twystron_va145h', 'twystron_va913a',
      'pulsed_klystron_4kmp10000lf', 'pulsed_klystron_8568', 'pulsed_klystron_l3035', 'pulsed_klystron_l3250',
      'pulsed_klystron_l3403', 'pulsed_klystron_sac42a', 'pulsed_klystron_va842', 'pulsed_klystron_z5010a',
      'pulsed_klystron_zm3038a', 'klystron_low_power', 'cw_klystron_3k3000lq', 'cw_klystron_3k50000lf',
      'cw_klystron_3k21000lq', 'cw_klystron_3km300la', 'cw_klystron_3km3000la', 'cw_klystron_3km50000pa',
      'cw_klystron_3km50000pa1', 'cw_klystron_3km50000pa2', 'cw_klystron_4k3cc', 'cw_klystron_4k3sk',
      'cw_klystron_4k50000lq', 'cw_klystron_4km50lb', 'cw_klystron_4km50lc', 'cw_klystron_4km50sj',
      'cw_klystron_4km50sk', 'cw_klystron_4km3000lr', 'cw_klystron_4km50000lq', 'cw_klystron_4km50000lr',
      'cw_klystron_4km170000la', 'cw_klystron_8824', 'cw_klystron_8825', 'cw_klystron_8826',
      'cw_klystron_va800e', 'cw_klystron_va853', 'cw_klystron_va856b', 'cw_klystron_va888e',
      'pulsed_klystron_unlisted', 'cw_klystron_unlisted',
    ], default: 'receiver_triode_tetrode_pentode' },
    { key: 'years_since_introduction', label: 'Years since introduction', type: 'number', default: 3, step: 0.1, min: 0 },
    { key: 'frequency', label: 'Unlisted klystron frequency (GHz pulsed, MHz CW)', type: 'number', default: 1, step: 0.1, min: 0.000001 },
    { key: 'output_power', label: 'Unlisted klystron output (MW pulsed, kW CW)', type: 'number', default: 0.1, step: 0.1, min: 0.000001 },
  ],
  traveling_wave_tube: [
    { key: 'rated_power_watts', label: 'Rated power (W)', type: 'number', default: 100, step: 1, min: 0.001, max: 40000 },
    { key: 'frequency_ghz', label: 'Frequency (GHz)', type: 'number', default: 4, step: 0.1, min: 0.1, max: 18 },
  ],
  magnetron: [
    { key: 'operation', label: 'Operation', type: 'select', options: ['pulsed', 'continuous'], default: 'pulsed' },
    { key: 'frequency_ghz', label: 'Pulsed frequency (GHz)', type: 'number', default: 1, step: 0.1, min: 0.1, max: 100 },
    { key: 'output_power_mw', label: 'Pulsed output power (MW)', type: 'number', default: 0.1, step: 0.1, min: 0.01, max: 5 },
    { key: 'rated_power_kw', label: 'CW rated power (kW)', type: 'number', default: 1, step: 0.1, min: 0.000001, max: 4.999 },
    { key: 'radiate_to_filament_ratio', label: 'Radiate/filament time ratio', type: 'number', default: 1, step: 0.05, min: 0, max: 1 },
    { key: 'construction', label: 'Construction', type: 'select', options: ['coaxial_pulsed', 'conventional_pulsed', 'continuous'], default: 'coaxial_pulsed' },
  ],
  gas_laser: [
    { key: 'laser_type', label: 'Gas laser type', type: 'select', options: ['helium_neon', 'helium_cadmium', 'argon'], default: 'helium_neon' },
  ],
  sealed_co2_laser: [
    { key: 'tube_current_ma', label: 'Tube current (mA)', type: 'number', default: 20, step: 1, min: 10, max: 150 },
    { key: 'co2_overfill_percent', label: 'CO₂ overfill (%)', type: 'number', default: 0, step: 1, min: 0, max: 50 },
    { key: 'ballast_volume_increase_percent', label: 'Ballast-volume increase (%)', type: 'number', default: 0, step: 1, min: 0 },
    { key: 'active_optical_surfaces', label: 'Active optical surfaces', type: 'number', default: 1, step: 1, min: 1 },
  ],
  flowing_co2_laser: [
    { key: 'average_output_power_kw', label: 'Average output power (kW)', type: 'number', default: 0.1, step: 0.01, min: 0.01, max: 1 },
    { key: 'active_optical_surfaces', label: 'Active optical surfaces', type: 'number', default: 1, step: 1, min: 1 },
  ],
  solid_state_laser: [
    { key: 'laser_type', label: 'Laser medium', type: 'select', options: ['nd_yag', 'ruby'], default: 'nd_yag' },
    { key: 'pump_type', label: 'Pump lamp', type: 'select', options: ['xenon', 'krypton'], default: 'xenon' },
    { key: 'pulses_per_second', label: 'Pulses per second', type: 'number', default: 10, step: 1, min: 0.000001 },
    { key: 'input_energy_joules', label: 'Xenon input energy (J)', type: 'number', default: 40, step: 1, min: 0.000001 },
    { key: 'lamp_diameter_mm', label: 'Lamp diameter (mm)', type: 'number', default: 4, step: 0.1, min: 0.000001 },
    { key: 'lamp_arc_length_inches', label: 'Lamp arc length (in)', type: 'number', default: 2, step: 0.1, min: 0.000001 },
    { key: 'pulse_width_microseconds', label: 'Pulse width (µs)', type: 'number', default: 100, step: 1, min: 0.000001 },
    { key: 'input_power_kw', label: 'Krypton input power (kW)', type: 'number', default: 4, step: 0.1, min: 0.000001 },
    { key: 'energy_density_j_cm2', label: 'Ruby energy density (J/cm²)', type: 'number', default: 1, step: 0.1, min: 0.000001 },
    { key: 'cooling', label: 'Cooling', type: 'select', options: ['gas', 'liquid'], default: 'liquid' },
    { key: 'cleanliness', label: 'Optics cleanliness', type: 'select', options: ['rigorous', 'minimal_bellows', 'minimal_no_bellows'], default: 'rigorous' },
    { key: 'active_optical_surfaces', label: 'Active optical surfaces', type: 'number', default: 1, step: 1, min: 1 },
  ],
  resistor: [
    { key: 'style', label: 'MIL resistor style', type: 'select', options: ['RC', 'RCR', 'RL', 'RLR', 'RN', 'RNR', 'RM', 'RD', 'RZ', 'RB', 'RBR', 'RW', 'RWR', 'RE', 'RER', 'RTH', 'RT', 'RTR', 'RR', 'RA', 'RK', 'RP', 'RJ', 'RJR', 'RV', 'RQ', 'RVC'], default: 'RL' },
    { key: 'power_stress', label: 'Power stress ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'rated_power', label: 'Rated power (W)', type: 'number', default: 0.5, step: 0.1, min: 0.000001 },
    { key: 'case_temperature_c', label: 'Resistor case temperature (°C)', type: 'number', default: 40, step: 1, min: -65, max: 250 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'non-ER', 'commercial'], default: 'commercial' },
  ],
  capacitor: [
    { key: 'style', label: 'MIL/A/V capacitor style', type: 'select', options: ['CP', 'CA', 'CZ', 'CZR', 'CQ', 'CQR', 'CH', 'CHR', 'CFR', 'CRH', 'CM', 'CMR', 'CB', 'CY', 'CYR', 'CK', 'CKR', 'CC', 'CCR', 'CDR', 'PS', 'CSR', 'CWR', 'CL', 'CLR', 'CRL', 'CU', 'CUR', 'CE', 'CV', 'PC', 'CT', 'CG'], default: 'CK', help: 'PS is the A/V51.1 MIL-PRF-49470 mapping; Perdura uses the closest Section 10 CDR ceramic-chip equation.' },
    { key: 'capacitance_microfarads', label: 'Capacitance (µF)', type: 'number', default: 0.1, step: 0.01, min: 0.000000001 },
    { key: 'voltage_stress', label: 'Voltage stress ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_ambient', label: 'Ambient temperature (°C)', type: 'number', default: 40, step: 1, min: -65, max: 250 },
    { key: 'circuit_resistance_ohm_per_volt', label: 'Circuit resistance (Ω/V, CSR/CWR)', type: 'number', default: 1, step: 0.1, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['D', 'C', 'S', 'B', 'R', 'P', 'M', 'L', 'non-ER', 'commercial'], default: 'commercial' },
  ],
  transformer: [
    { key: 'transformer_type', label: 'Transformer type', type: 'select', options: ['flyback', 'audio', 'low_power_pulse', 'high_power_pulse', 'rf'], default: 'low_power_pulse' },
    { key: 'T_hotspot', label: 'Hot-spot temperature (°C)', type: 'number', default: 60, step: 1, min: -65, max: 300 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower'], default: 'lower' },
  ],
  inductor_coil: [
    { key: 'adjustment', label: 'Inductor type', type: 'select', options: ['fixed', 'variable'], default: 'fixed' },
    { key: 'T_hotspot', label: 'Hot-spot temperature (°C)', type: 'number', default: 60, step: 1, min: -65, max: 300 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'MIL-SPEC', 'non-ER'], default: 'non-ER' },
  ],
  ferrite_bead: [
    { key: 'T_ambient', label: 'Ambient temperature (°C; rise neglected)', type: 'number', default: 40, step: 1, min: -65, max: 250 },
    { key: 'quality_basis', label: 'Quality-factor basis', type: 'select', options: ['recommended', 'appendix_a_reproduction'], default: 'recommended', help: 'A/V51.1 recommends πQ=3 for subsequent use; πQ=1 only reproduces the Appendix A inductor row.' },
  ],
  motor: [
    { key: 'motor_type', label: 'Motor type (<1 hp)', type: 'select', options: ['general', 'sensor', 'servo', 'stepper'], default: 'general' },
    { key: 'T_ambient', label: 'Ambient temperature (°C)', type: 'number', default: 50, step: 1, min: -65, max: 250 },
    { key: 'life_cycle_hours', label: 'Design life / overhaul interval (hours)', type: 'number', default: 87600, step: 1000, min: 1 },
    { key: 'temperature_profile', label: 'Temperature profile (optional)', type: 'text', default: '', optional: true, placeholder: '[[hours, °C], ...]', help: 'Optional Section 12.1 weighted profile as JSON pairs of [hours, ambient temperature °C], for example [[1000, 25], [500, 70]]. Leave blank for a single ambient temperature.' },
  ],
  synchro_resolver: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['synchro', 'resolver'], default: 'synchro' },
    { key: 'frame_temperature', label: 'Frame temperature (°C)', type: 'number', default: 60, step: 1, min: -65, max: 250 },
    { key: 'frame_size', label: 'Frame size', type: 'number', default: 10, step: 1, min: 1 },
    { key: 'brushes', label: 'Brushes', type: 'number', default: 2, step: 1, min: 1, max: 4 },
  ],
  elapsed_time_meter: [
    { key: 'drive_type', label: 'Drive type', type: 'select', options: ['ac', 'inverter', 'commutator_dc'], default: 'ac' },
    { key: 'operating_to_rated_temperature', label: 'Operating/rated temperature ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
  ],
  relay: [
    { key: 'rated_temperature', label: 'Rated temperature (°C)', type: 'select', options: ['85', '125'], default: 125 },
    { key: 'T_ambient', label: 'Ambient temperature (°C)', type: 'number', default: 40, step: 1, min: -65, max: 250 },
    { key: 'load_type', label: 'Load type', type: 'select', options: ['resistive', 'inductive', 'lamp'], default: 'resistive' },
    { key: 'load_stress', label: 'Load stress ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'contact_form', label: 'Contact form', type: 'select', options: ['SPST', 'DPST', 'SPDT', '3PST', '4PST', 'DPDT', '3PDT', '4PDT', '6PDT'], default: 'DPDT' },
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, step: 1, min: 0 },
    { key: 'configuration', label: 'Application / construction', type: 'select', options: [
      'signal_dry_armature_long', 'signal_dry_reed', 'signal_mercury_wetted', 'signal_magnetic_latching', 'signal_balanced_armature', 'signal_solenoid',
      'general_armature_long', 'general_balanced_armature', 'general_solenoid', 'sensitive_armature', 'sensitive_mercury_wetted',
      'sensitive_magnetic_latching', 'sensitive_meter_movement', 'sensitive_balanced_armature', 'polarized_armature_short', 'polarized_meter_movement',
      'vibrating_dry_reed', 'vibrating_mercury_wetted', 'high_speed_armature', 'high_speed_dry_reed', 'thermal_time_delay_bimetal',
      'electronic_time_delay', 'latching_dry_reed', 'latching_mercury_wetted', 'latching_balanced_armature', 'high_voltage_vacuum_glass',
      'high_voltage_vacuum_ceramic', 'medium_power_armature', 'medium_power_mercury_wetted', 'medium_power_magnetic_latching',
      'medium_power_mechanical_latching', 'medium_power_balanced_armature', 'medium_power_solenoid', 'contactor_armature_short',
      'contactor_mechanical_latching', 'contactor_balanced_armature', 'contactor_solenoid',
    ], default: 'general_armature_long' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['R', 'P', 'X', 'U', 'M', 'L', 'MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  ss_relay: [
    { key: 'relay_type', label: 'Relay type', type: 'select', options: ['solid_state', 'solid_state_time_delay', 'hybrid'], default: 'solid_state' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  switch: [
    { key: 'switch_type', label: 'Switch type', type: 'select', options: ['centrifugal', 'dip', 'limit', 'liquid', 'microwave', 'pressure', 'pushbutton', 'reed', 'rocker', 'rotary', 'sensitive', 'thermal', 'thumbwheel', 'toggle'], default: 'toggle' },
    { key: 'load_type', label: 'Load type', type: 'select', options: ['resistive', 'inductive', 'lamp'], default: 'resistive' },
    { key: 'load_stress', label: 'Load stress ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'rated_by_inductive_load', label: 'Switch is rated by inductive load', type: 'select', options: BOOLEAN_OPTIONS, default: 'false' },
    { key: 'active_contacts', label: 'Active contacts', type: 'number', default: 1, step: 1, min: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower'], default: 'lower' },
  ],
  circuit_breaker: [
    { key: 'breaker_type', label: 'Breaker type', type: 'select', options: ['magnetic', 'thermal', 'thermal_magnetic'], default: 'magnetic' },
    { key: 'poles', label: 'Poles', type: 'number', default: 1, step: 1, min: 1, max: 4 },
    { key: 'usage', label: 'Usage', type: 'select', options: ['normal', 'power_on_off'], default: 'normal' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower'], default: 'lower' },
  ],
  connector: [
    { key: 'connector_type', label: 'Connector type', type: 'select', options: ['circular', 'card_edge', 'hexagonal', 'rack_panel', 'rectangular', 'rf_coaxial', 'telephone', 'power', 'triaxial'], default: 'circular' },
    { key: 'T_ambient', label: 'Ambient temperature (°C)', type: 'number', default: 40, step: 1, min: -65, max: 250 },
    { key: 'insert_temperature_rise', label: 'Insert temperature rise (°C)', type: 'number', default: 0, step: 1, min: 0 },
    { key: 'matings_per_1000_hours', label: 'Matings per 1000 hours', type: 'number', default: 0.05, step: 0.05, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower'], default: 'lower' },
    { key: 'assembly', label: 'Assembly basis', type: 'select', options: ['mated_pair', 'single_half'], default: 'mated_pair' },
    { key: 'vita_use_standard_defaults', label: 'Use A/V module/CCA connector defaults', type: 'select', options: BOOLEAN_OPTIONS, default: 'true', help: 'When A/V51.1 is active, uses rectangular, single connector, 0.05 matings/1000 h. Select false when the entered connector data are known actuals.' },
  ],
  connector_socket: [
    { key: 'socket_type', label: 'Socket type', type: 'select', options: ['dip_sip_chip_pga', 'relay', 'transistor', 'tube_crt'], default: 'dip_sip_chip_pga' },
    { key: 'active_pins', label: 'Active pins', type: 'number', default: 16, step: 1, min: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower'], default: 'lower' },
  ],
  pth_assembly: [
    { key: 'method', label: 'Calculation method', type: 'select', options: ['auto', 'handbook', 'vita_pof'], default: 'auto', help: 'Auto selects MIL §16.1 without A/V51.1 and the recommended Appendix F fatigue solver when A/V51.1 is checked.' },
    { key: 'technology', label: 'Technology', type: 'select', options: ['printed_board', 'discrete_wiring'], default: 'printed_board' },
    { key: 'automated_pths', label: 'Automated/wave-soldered PTHs', type: 'number', default: 100, step: 1, min: 0 },
    { key: 'hand_soldered_pths', label: 'Hand-soldered PTHs', type: 'number', default: 0, step: 1, min: 0 },
    { key: 'circuit_planes', label: 'Circuit planes', type: 'number', default: 2, step: 1, min: 2, max: 18 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['IPC_level_3', 'lower'], default: 'lower' },
    { key: 'laminate', label: 'Appendix F laminate', type: 'select', options: ['epoxy_aramid', 'epoxy_glass_fr4_g10', 'epoxy_quartz', 'polyimide_aramid', 'polyimide_glass', 'polyimide_quartz', 'ptfe_glass'], default: 'epoxy_glass_fr4_g10' },
    { key: 'temperature_range_c', label: 'Thermal-cycle range ΔT (°C)', type: 'number', default: 100, step: 1, min: 0.000001 },
    { key: 'board_thickness_inches', label: 'Board thickness h (in)', type: 'number', default: 0.062, step: 0.001, min: 0.000001 },
    { key: 'drilled_hole_diameter_inches', label: 'Drilled PTH diameter d (in)', type: 'number', default: 0.02, step: 0.001, min: 0.000001 },
    { key: 'plating_thickness_inches', label: 'PTH plating thickness t (in)', type: 'number', default: 0.001, step: 0.0001, min: 0.000001 },
    { key: 'hours_per_thermal_cycle', label: 'Hours per thermal cycle H꜀', type: 'number', default: 24, step: 1, min: 0.000001 },
    { key: 'laminate_elastic_modulus_psi', label: 'Measured laminate E₁ (psi, optional)', type: 'number', default: '', step: 1000, min: 0.000001, optional: true, placeholder: 'Use Appendix F table' },
    { key: 'laminate_cte_per_c', label: 'Measured laminate z-CTE α₁ (/°C, optional)', type: 'number', default: '', step: 0.000001, min: 0.000000001, optional: true, placeholder: 'Use Appendix F table' },
    { key: 'copper_cte_per_c', label: 'Copper CTE α₂ (/°C)', type: 'number', default: 0.000018, step: 0.000001, min: 0.000000001 },
    { key: 'copper_yield_strength_psi', label: 'Copper yield strength Sᵧ (psi)', type: 'number', default: 25000, step: 1000, min: 0.000001 },
    { key: 'copper_elastic_modulus_psi', label: 'Copper elastic modulus E₂ (psi)', type: 'number', default: 12000000, step: 100000, min: 0.000001 },
    { key: 'copper_plastic_modulus_psi', label: "Copper plastic modulus E₂′ (psi)", type: 'number', default: 100000, step: 10000, min: 0.000001 },
    { key: 'copper_ductility', label: 'Copper ductility D꜀', type: 'number', default: 0.3, step: 0.01, min: 0.000001, max: 2 },
    { key: 'copper_ultimate_strength_psi', label: 'Copper ultimate strength Sᵤ (psi)', type: 'number', default: 40000, step: 1000, min: 0.000001 },
  ],
  surface_mount_assembly: [
    { key: 'distance_to_neutral_point_mils', label: 'Distance to neutral point, d (mils)', type: 'number', default: 740, step: 1, min: 0.000001 },
    { key: 'solder_joint_height_mils', label: 'Solder-joint height, h (mils)', type: 'number', default: 5, step: 0.1, min: 0.000001 },
    { key: 'substrate', label: 'Substrate', type: 'select', options: ['fr4_laminate', 'fr4_multilayer', 'fr4_multilayer_copper_clad_invar', 'ceramic_multilayer', 'copper_clad_invar', 'copper_clad_molybdenum', 'carbon_fiber_epoxy', 'kevlar_fiber', 'quartz_fiber', 'glass_fiber', 'epoxy_glass', 'polyimide_glass', 'polyimide_kevlar', 'polyimide_quartz', 'epoxy_kevlar', 'alumina_ceramic', 'epoxy_aramid', 'polyimide_aramid', 'epoxy_quartz', 'fiberglass_teflon', 'porcelainized_copper_clad_invar', 'fiberglass_ceramic'], default: 'epoxy_glass' },
    { key: 'package', label: 'Component package', type: 'select', options: ['plastic', 'ceramic'], default: 'plastic' },
    { key: 'lead_configuration', label: 'Lead configuration', type: 'select', options: ['leadless', 'j_or_s_lead', 'gull_wing', 'plastic_bga', 'ceramic_bga'], default: 'leadless', help: 'A/V51.1 adds πLC=100 for plastic BGA and 50 for ceramic BGA.' },
    { key: 'equipment_type', label: 'Equipment cycling profile', type: 'select', options: ['automotive', 'consumer', 'computer', 'telecommunications', 'commercial_aircraft', 'industrial', 'military_ground', 'military_aircraft_cargo', 'military_aircraft_fighter'], default: 'military_ground' },
    { key: 'cycling_rate_source', label: 'Cycling-rate source', type: 'select', options: ['table', 'custom'], default: 'table' },
    { key: 'cycling_rate_per_hour', label: 'Thermal cycling rate (cycles/hour)', type: 'number', default: 0.03, step: 0.01, min: 0.000001 },
    { key: 'temperature_difference_source', label: 'ΔT source', type: 'select', options: ['table', 'custom'], default: 'table' },
    { key: 'temperature_difference', label: 'Ambient temperature range ΔT (°C)', type: 'number', default: 21, step: 1, min: 0.000001 },
    { key: 'thermal_resistance_c_per_watt', label: 'Thermal resistance (°C/W)', type: 'number', default: 20, step: 1, min: 0 },
    { key: 'power_dissipation_watts', label: 'Power dissipation (W)', type: 'number', default: 0.5, step: 0.1, min: 0 },
    { key: 'design_life_hours', label: 'Design life (hours)', type: 'number', default: 175200, step: 1000, min: 1 },
  ],
  connection: [
    { key: 'connection_type', label: 'Connection type', type: 'select', options: ['hand_solder_no_wrap', 'hand_solder_wrapped', 'crimp', 'weld', 'solderless_wrap', 'clip_termination', 'reflow_solder', 'spring_contact', 'terminal_block'], default: 'reflow_solder' },
  ],
  meter: [
    { key: 'application', label: 'Application', type: 'select', options: ['dc', 'ac'], default: 'dc' },
    { key: 'function', label: 'Function', type: 'select', options: ['ammeter', 'voltmeter', 'other'], default: 'ammeter' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-M-10304', 'lower'], default: 'lower' },
  ],
  crystal: [
    { key: 'frequency_mhz', label: 'Frequency (MHz)', type: 'number', default: 10, step: 1, min: 0.000001 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower'], default: 'lower' },
  ],
  oscillator: [
    { key: 'frequency_mhz', label: 'Frequency (MHz)', type: 'number', default: 10, step: 1, min: 0.000001 },
  ],
  mems_oscillator: [
    { key: 'T_ambient', label: 'Ambient temperature (°C)', type: 'number', default: 20, step: 1, min: -65, max: 250 },
    { key: 'temperature_rise_c', label: 'Junction temperature rise (°C)', type: 'number', default: 30, step: 1, min: 0 },
    { key: 'pins', label: 'Package pins', type: 'number', default: 14, step: 1, min: 1 },
    { key: 'package', label: 'Microcircuit proxy package', type: 'select', options: ['hermetic_dip', 'hermetic_pga', 'hermetic_smt', 'glass_dip', 'flatpack', 'can', 'nonhermetic', 'nonhermetic_dip', 'nonhermetic_pga', 'nonhermetic_smt'], default: 'hermetic_dip' },
  ],
  lamp: [
    { key: 'rated_voltage', label: 'Rated voltage (V)', type: 'number', default: 28, step: 1, min: 0.000001 },
    { key: 'utilization_ratio', label: 'Utilization ratio', type: 'number', default: 1, step: 0.05, min: 0, max: 1 },
    { key: 'application', label: 'Application', type: 'select', options: ['ac', 'dc'], default: 'ac' },
  ],
  filter: [
    { key: 'filter_type', label: 'Filter type', type: 'select', options: ['ceramic_ferrite_mil_f_15733', 'discrete_lc_mil_f_15733', 'discrete_lc_mil_f_18327_composition_1', 'discrete_lc_crystal_mil_f_18327_composition_2'], default: 'ceramic_ferrite_mil_f_15733' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower'], default: 'lower' },
  ],
  fuse: [],
  miscellaneous: [
    { key: 'part_type', label: 'Part type', type: 'select', options: ['vibrator_60hz', 'vibrator_120hz', 'vibrator_400hz', 'neon_lamp', 'single_fiber_connector', 'single_fiber_cable', 'microwave_attenuator', 'microwave_fixed_element', 'microwave_variable_element', 'ferrite_le_100w', 'ferrite_gt_100w', 'phase_shifter_latching', 'dummy_load_lt_100w', 'dummy_load_100_1000w', 'dummy_load_gt_1000w', 'termination'], default: 'neon_lamp' },
    { key: 'fiber_length_km', label: 'Fiber length (km; cable only)', type: 'number', default: 1, step: 0.1, min: 0.000001 },
    { key: 'attenuator_power_stress', label: 'Attenuator RD power-stress ratio', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'attenuator_rated_power_watts', label: 'Attenuator rated power (W)', type: 'number', default: 1, step: 0.1, min: 0.000001 },
    { key: 'attenuator_case_temperature_c', label: 'Attenuator case temperature (°C)', type: 'number', default: 40, step: 1, min: -65, max: 250 },
    { key: 'attenuator_quality', label: 'Attenuator quality', type: 'select', options: ['S', 'R', 'P', 'M', 'non-ER', 'commercial'], default: 'commercial' },
  ],
  detailed_cmos: [
    { key: 'evaluation_time_hours', label: 'Evaluation time (hours)', type: 'number', default: 10000, step: 1000, min: 1 },
    { key: 'device_type', label: 'Device type', type: 'select', options: ['logic_custom', 'memory_gate_array'], default: 'logic_custom' },
    { key: 'chip_area_cm2', label: 'Chip area (cm²)', type: 'number', default: 0.21, step: 0.01, min: 0.000001 },
    { key: 'feature_size_microns', label: 'Feature size (µm)', type: 'number', default: 2, step: 0.1, min: 0.000001 },
    { key: 'T_junction', label: 'Junction temperature (°C)', type: 'number', default: 75, step: 1, min: -65, max: 250 },
    { key: 'screening_temperature', label: 'Screening junction temperature (°C)', type: 'number', default: 125, step: 1, min: -65, max: 300 },
    { key: 'screening_time_hours', label: 'Screening time (hours)', type: 'number', default: 160, step: 1, min: 0 },
    { key: 'qml', label: 'QML process', type: 'select', options: BOOLEAN_OPTIONS, default: 'false' },
    { key: 'oxide_defect_density', label: 'Oxide defect density, Dₒₓ (optional override)', type: 'number', default: '', step: 0.1, min: 0.000001, optional: true, placeholder: 'Derived from feature size', help: 'Leave blank to use the Appendix B relation Dₒₓ = (2/Xs)².' },
    { key: 'oxide_field_mv_cm', label: 'Oxide field (MV/cm)', type: 'number', default: 2.5, step: 0.1, min: 0.000001 },
    { key: 'sigma_oxide', label: 'Oxide lognormal σ', type: 'number', default: 1, step: 0.1, min: 0.000001 },
    { key: 'metal_defect_density', label: 'Metal defect density, Dₘₑₜ (optional override)', type: 'number', default: '', step: 0.1, min: 0.000001, optional: true, placeholder: 'Derived from feature size', help: 'Leave blank to use the Appendix B relation Dₘₑₜ = (2/Xs)².' },
    { key: 'metal_type', label: 'Metal type', type: 'select', options: ['aluminum', 'al_cu_al_si_cu'], default: 'aluminum' },
    { key: 'metal_current_density_million_a_cm2', label: 'Metal current density (10⁶ A/cm²)', type: 'number', default: 1, step: 0.1, min: 0.000001 },
    { key: 'sigma_metal', label: 'Metal lognormal σ', type: 'number', default: 1, step: 0.1, min: 0.000001 },
    { key: 'drain_current_ma', label: 'Drain current, Iᴅ (mA; optional override)', type: 'number', default: '', step: 0.01, min: 0.000001, optional: true, placeholder: 'Derived from Tj', help: 'Leave blank to use Iᴅ = 3.5 exp(−0.00157 Tj[K]).' },
    { key: 'substrate_current_ma', label: 'Substrate current, Iₛᵤᵦ (mA; optional override)', type: 'number', default: '', step: 0.0001, min: 0.000001, optional: true, placeholder: 'Derived from Tj', help: 'Leave blank to use Iₛᵤᵦ = 0.0058 exp(−0.00689 Tj[K]).' },
    { key: 'sigma_hot_carrier', label: 'Hot-carrier lognormal σ', type: 'number', default: 1, step: 0.1, min: 0.000001 },
    { key: 'pins', label: 'Package pins', type: 'number', default: 64, step: 1, min: 1 },
    { key: 'package_type', label: 'Package type', type: 'select', options: ['dip', 'pin_grid_array', 'chip_carrier'], default: 'dip' },
    { key: 'package_material', label: 'Package material', type: 'select', options: ['hermetic', 'plastic'], default: 'hermetic' },
    { key: 'T_ambient', label: 'Ambient temperature (°C)', type: 'number', default: 25, step: 1, min: -65, max: 250 },
    { key: 'relative_humidity', label: 'Relative humidity (%)', type: 'number', default: 50, step: 1, min: 0.01, max: 100 },
    { key: 'humidity_duty_cycle', label: 'Humidity duty cycle', type: 'number', default: 1, step: 0.05, min: 0, max: 1 },
    { key: 'esd_threshold_volts', label: 'ESD threshold (V)', type: 'number', default: 1000, step: 100, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: MIL_MICRO_QUALITY, default: 'commercial' },
  ],
  parts_count: [
    { key: 'part_type', label: 'Appendix A part type', type: 'select', options: ['ic_bipolar_digital_100'], default: 'ic_bipolar_digital_100' },
    { key: 'quality', label: 'Appendix A quality level', type: 'select', options: ['S', 'B', 'B-1', 'commercial'], default: 'commercial' },
    { key: 'years_in_production', label: 'Years in production (microcircuits)', type: 'number', default: 2, step: 0.1, min: 0 },
    { key: 'manufacturer_rate_fpmh', label: 'Manufacturer rate (FPMH, optional)', type: 'number', default: '', step: 0.000001, min: 0, optional: true, placeholder: 'Use Appendix A rate', help: 'With A/V51.1 active, converts manufacturer data by the Appendix H target/reference generic-rate ratio.' },
    { key: 'manufacturer_reference_environment', label: 'Manufacturer reference environment', type: 'select', options: ENVIRONMENTS.map(e => e.code), default: 'GB' },
  ],
  custom: USER_DEFINED_FIELDS.custom,
  generic: USER_DEFINED_FIELDS.generic,
}

const MIL_NOTICE2_LABELS: Record<string, string> = {
  microcircuit: 'Monolithic IC / Memory (§5.1–5.2)',
  vhsic_microcircuit: 'VHSIC / VLSI CMOS — Simplified model (§5.3)',
  gaas_microcircuit: 'GaAs MMIC / Digital IC (§5.4)',
  hybrid_microcircuit: 'Hybrid Microcircuit (§5.5)', saw_device: 'Surface Acoustic Wave Device (§5.6)',
  bubble_memory: 'Magnetic Bubble Memory (§5.7)', diode: 'Low-Frequency Diode (§6.1)',
  hf_diode: 'High-Frequency Diode (§6.2)', bjt: 'Low-Frequency Bipolar Transistor (§6.3)',
  fet: 'Low-Frequency Silicon FET (§6.4)', unijunction: 'Unijunction Transistor (§6.5)',
  hf_low_noise_bjt: 'HF Low-Noise Bipolar Transistor (§6.6)', hf_power_bjt: 'HF Power Bipolar Transistor (§6.7)',
  gaas_fet: 'High-Frequency GaAs FET (§6.8)', hf_silicon_fet: 'High-Frequency Silicon FET (§6.9)',
  thyristor: 'Thyristor / SCR (§6.10)', optoelectronic: 'Optoelectronic / Display (§6.11–6.12)',
  laser_diode: 'Laser Diode (§6.13)', electron_tube: 'Electron Tube (§7.1)',
  traveling_wave_tube: 'Traveling-Wave Tube (§7.2)', magnetron: 'Magnetron (§7.3)',
  gas_laser: 'Helium / Argon Gas Laser (§8.1)', sealed_co2_laser: 'Sealed CO₂ Laser (§8.2)',
  flowing_co2_laser: 'Flowing CO₂ Laser (§8.3)', solid_state_laser: 'Solid-State Laser (§8.4)',
  resistor: 'Resistor (§9.1)', capacitor: 'Capacitor (§10.1)', transformer: 'Transformer (§11.1)',
  inductor_coil: 'Inductor / Coil (§11.2)', ferrite_bead: 'Ferrite Bead (A/V51.1 §2.1.6.1)', motor: 'Motor below 1 hp (§12.1)',
  synchro_resolver: 'Synchro / Resolver (§12.2)', elapsed_time_meter: 'Elapsed-Time Meter (§12.3)',
  relay: 'Mechanical Relay (§13.1)', ss_relay: 'Solid-State / Time-Delay Relay (§13.2)',
  switch: 'Switch (§14.1)', circuit_breaker: 'Circuit Breaker (§14.2)', connector: 'Connector (§15.1)',
  connector_socket: 'Connector Socket (§15.2)', pth_assembly: 'Plated-Through-Hole Assembly (§16.1)',
  surface_mount_assembly: 'Surface-Mount Assembly (§16.2)', connection: 'Single Connection (§17.1)',
  meter: 'Panel Meter (§18.1)', crystal: 'Quartz Crystal (§19.1)', oscillator: 'Oscillator (A/V51.1 §2.1.13)',
  mems_oscillator: 'MEMS Oscillator (A/V51.1 Appendix G)', lamp: 'Incandescent Lamp (§20.1)',
  filter: 'Electronic Filter (§21.1)', fuse: 'Fuse (§22.1)', miscellaneous: 'Miscellaneous Part (§23.1)',
  detailed_cmos: 'VHSIC / VLSI CMOS — Detailed time-dependent model (Appendix B)', parts_count: 'Parts Count Line Item (Appendix A)',
  custom: 'Custom (Exponential / Weibull)', generic: 'Generic User-Supplied Rate',
}

// ---------------------------------------------------------------------------
// Multi-standard support
// ---------------------------------------------------------------------------

type PredictionStandard =
  | 'MIL-HDBK-217F' | 'Telcordia' | '217Plus' | 'FIDES' | 'NSWC'
  | 'EPRD-2014' | 'NPRD-2023'

const STANDARD_INFO: Record<PredictionStandard, { name: string; description: string }> = {
  'MIL-HDBK-217F': { name: 'MIL-HDBK-217F Notice 2', description: 'US Military electronic equipment reliability prediction' },
  'Telcordia': { name: 'Telcordia SR-332', description: 'Telecommunications industry reliability prediction' },
  '217Plus': { name: '217Plus (RIAC)', description: 'Modernized successor with process grade factors' },
  'FIDES': { name: 'FIDES Guide 2022', description: 'European physics-of-failure with process assessment' },
  'NSWC': { name: 'NSWC-98/LE1', description: 'Mechanical equipment reliability (springs, bearings, gears…)' },
  'EPRD-2014': { name: 'EPRD-2014 (Quanterion/RIAC)', description: 'Empirical field-experience failure rates for electronic parts' },
  'NPRD-2023': { name: 'NPRD-2023 (Quanterion/RIAC)', description: 'Empirical field-experience failure rates for nonelectronic parts' },
}

function MethodologyNotice({ disclosure, compact = false }: {
  disclosure: MethodologyDisclosure
  compact?: boolean
}) {
  // Verified status is documented in Help/methodology materials; repeating a
  // green certification badge throughout the working surface adds noise. Keep
  // partial/screening/custom notices because those carry actionable caveats.
  if (disclosure.conformance_tier === 'verified') return null
  const tone = disclosure.conformance_tier === 'partial'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : disclosure.conformance_tier === 'custom' || disclosure.conformance_tier === 'unavailable'
        ? 'border-gray-200 bg-gray-50 text-gray-800'
        : 'border-orange-200 bg-orange-50 text-orange-900'
  if (compact) {
    return (
      <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-semibold ${tone}`}
        title={`${disclosure.tier_definition.meaning} ${disclosure.known_exclusions}`}>
        {disclosure.tier_definition.label}
      </span>
    )
  }
  return (
    <div className={`mb-4 rounded border px-3 py-2 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{disclosure.tier_definition.label}</span>
        <span className="text-[10px] opacity-75">{disclosure.edition}</span>
      </div>
      <p className="mt-1">{disclosure.tier_definition.meaning}</p>
      <p className="mt-1 font-medium">{disclosure.tier_definition.contract_use}</p>
      <details className="mt-1.5 text-[10px]">
        <summary className="cursor-pointer font-medium">Scope, provenance, and validation</summary>
        <div className="mt-1 space-y-1 opacity-90">
          <p><b>Implemented:</b> {disclosure.implementation_scope}</p>
          <p><b>Exclusions:</b> {disclosure.known_exclusions}</p>
          <p><b>Clause coverage:</b> {disclosure.clause_coverage.join('; ')}</p>
          <p><b>Example parity:</b> {disclosure.authoritative_example_validation.note}</p>
          <p><b>Source:</b>{' '}
            {disclosure.source.url
              ? <a href={disclosure.source.url} target="_blank" rel="noreferrer" className="underline">{disclosure.source.title}</a>
              : disclosure.source.title}
            {' '}({disclosure.source.access})
          </p>
        </div>
      </details>
    </div>
  )
}

const TELCORDIA_LABELS: Record<string, string> = {
  ic_digital: 'IC — Digital', ic_linear: 'IC — Linear', ic_memory: 'IC — Memory',
  ic_microprocessor: 'IC — Microprocessor', diode: 'Diode', transistor_bjt: 'Transistor (BJT)',
  transistor_fet: 'Transistor (FET)', resistor: 'Resistor', capacitor: 'Capacitor',
  inductor: 'Inductor', transformer: 'Transformer', relay: 'Relay', switch: 'Switch',
  connector: 'Connector', crystal: 'Crystal', fuse: 'Fuse', pcb: 'PCB',
}
const TELCORDIA_FIELDS: Record<string, Field[]> = {
  ic_digital: [
    { key: 'complexity', label: 'Gates', type: 'number', default: 1000, min: 1 },
    { key: 'package', label: 'Package', type: 'select', options: ['dip', 'smd', 'bga', 'qfp', 'plcc'], default: 'smd' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  ic_linear: [
    { key: 'transistor_count', label: 'Transistor count', type: 'number', default: 100, min: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  ic_memory: [
    { key: 'bits', label: 'Bit count', type: 'number', default: 1048576, min: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  ic_microprocessor: [
    { key: 'transistor_count', label: 'Transistor count', type: 'number', default: 1000000, min: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  diode: [
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  transistor_bjt: [
    { key: 'rated_power', label: 'Rated power (W)', type: 'number', default: 0.5, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  transistor_fet: [
    { key: 'rated_power', label: 'Rated power (W)', type: 'number', default: 0.5, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  resistor: [
    { key: 'power_stress', label: 'Power stress (P/Prated)', type: 'number', default: 0.5, min: 0, max: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  capacitor: [
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5, min: 0, max: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  inductor: [
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  transformer: [
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  relay: [
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  switch: [
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  connector: [
    { key: 'pins', label: 'Active pins', type: 'number', default: 25, min: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  crystal: [
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  fuse: [
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  pcb: [
    { key: 'layers', label: 'Layers', type: 'number', default: 4, min: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['telcordia', 'commercial_best', 'commercial', 'unknown'], default: 'commercial' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
}
const TELCORDIA_ENVIRONMENTS = [
  { code: 'GC', label: 'GC — Ground, Controlled' },
  { code: 'GF', label: 'GF — Ground, Fixed' },
  { code: 'GM', label: 'GM — Ground, Mobile' },
  { code: 'CL', label: 'CL — Climate-controlled' },
  { code: 'NU', label: 'NU — Naval, Unsheltered' },
  { code: 'AF', label: 'AF — Airborne, Fixed-wing' },
  { code: 'AUF', label: 'AUF — Airborne, Uninhabited' },
]

const PLUS217_LABELS: Record<string, string> = {
  microcircuit: 'Microcircuit', discrete_semiconductor: 'Discrete Semiconductor',
  resistor: 'Resistor', capacitor: 'Capacitor', inductor: 'Inductor',
  relay: 'Relay', switch: 'Switch', connector: 'Connector',
  pcb: 'PCB', crystal: 'Crystal', fuse: 'Fuse', rotating: 'Rotating Device',
}
const PLUS217_FIELDS: Record<string, Field[]> = {
  microcircuit: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['digital', 'linear', 'microprocessor', 'memory', 'analog', 'mixed_signal'], default: 'digital' },
    { key: 'complexity', label: 'Gates / transistors', type: 'number', default: 1000, min: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  discrete_semiconductor: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['diode', 'transistor_bjt', 'transistor_fet', 'thyristor', 'optoelectronic'], default: 'diode' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  resistor: [
    { key: 'power_stress', label: 'Power stress (P/Prated)', type: 'number', default: 0.5, min: 0, max: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  capacitor: [
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5, min: 0, max: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  inductor: [
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  relay: [
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  switch: [
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  connector: [
    { key: 'pins', label: 'Active pins', type: 'number', default: 25, min: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  pcb: [
    { key: 'layers', label: 'Layers', type: 'number', default: 4, min: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  crystal: [
    { key: 'frequency_mhz', label: 'Frequency (MHz)', type: 'number', default: 10, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  fuse: [
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  rotating: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['motor', 'fan', 'pump', 'generator'], default: 'motor' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
}

const FIDES_LABELS: Record<string, string> = {
  ic: 'Integrated Circuit', discrete: 'Discrete Semiconductor',
  passive_resistor: 'Resistor', passive_capacitor: 'Capacitor', passive_inductor: 'Inductor',
  connector: 'Connector', pcb: 'PCB', relay: 'Relay', switch: 'Switch', crystal: 'Crystal',
}
const FIDES_FIELDS: Record<string, Field[]> = {
  ic: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['digital', 'linear', 'memory', 'microprocessor', 'mixed_signal'], default: 'digital' },
    { key: 'complexity', label: 'Transistor count', type: 'number', default: 10000, min: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  discrete: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['diode', 'transistor_bjt', 'transistor_fet', 'thyristor'], default: 'diode' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  passive_resistor: [
    { key: 'power_stress', label: 'Power stress (P/Prated)', type: 'number', default: 0.5, min: 0, max: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  passive_capacitor: [
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5, min: 0, max: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  passive_inductor: [
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  connector: [
    { key: 'pins', label: 'Active pins', type: 'number', default: 25, min: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  pcb: [
    { key: 'layers', label: 'Layers', type: 'number', default: 4, min: 1 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  relay: [
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  switch: [
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  crystal: [
    { key: 'frequency_mhz', label: 'Frequency (MHz)', type: 'number', default: 10, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
}

const NSWC_LABELS: Record<string, string> = {
  spring: 'Spring', bearing: 'Bearing', gear: 'Gear', seal: 'Seal',
  valve: 'Valve', actuator: 'Actuator', pump: 'Pump', filter_mech: 'Filter',
  coupling: 'Coupling', brake_clutch: 'Brake / Clutch', electric_motor: 'Electric Motor',
  belt_chain: 'Belt / Chain Drive', hydraulic_line: 'Hydraulic / Pneumatic Line',
}
const NSWC_FIELDS: Record<string, Field[]> = {
  spring: [
    { key: 'spring_type', label: 'Type', type: 'select', options: ['compression', 'extension', 'torsion', 'leaf', 'belleville'], default: 'compression' },
    { key: 'material', label: 'Material', type: 'select', options: ['steel', 'stainless', 'bronze', 'inconel'], default: 'steel' },
    { key: 'wire_diameter_mm', label: 'Wire diameter (mm)', type: 'number', default: 2.0, min: 0 },
    { key: 'coil_diameter_mm', label: 'Coil diameter (mm)', type: 'number', default: 20.0, min: 0 },
    { key: 'n_active_coils', label: 'Active coils', type: 'number', default: 8, min: 1 },
    { key: 'max_deflection', label: 'Max deflection', type: 'number', default: 10.0, min: 0 },
    { key: 'operating_deflection', label: 'Operating deflection', type: 'number', default: 5.0, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 25 },
  ],
  bearing: [
    { key: 'bearing_type', label: 'Type', type: 'select', options: ['ball', 'roller_cylindrical', 'roller_spherical', 'roller_tapered', 'needle', 'journal', 'sleeve'], default: 'ball' },
    { key: 'load_kN', label: 'Load (kN)', type: 'number', default: 5.0, min: 0 },
    { key: 'rated_load_kN', label: 'Dynamic load rating (kN)', type: 'number', default: 20.0, min: 0 },
    { key: 'speed_rpm', label: 'Speed (RPM)', type: 'number', default: 1500, min: 0 },
    { key: 'rated_speed_rpm', label: 'Rated speed (RPM)', type: 'number', default: 5000, min: 0 },
    { key: 'lubrication', label: 'Lubrication', type: 'select', options: ['oil', 'grease', 'dry'], default: 'oil' },
    { key: 'contamination', label: 'Contamination', type: 'select', options: ['clean', 'moderate', 'dirty'], default: 'clean' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  gear: [
    { key: 'gear_type', label: 'Type', type: 'select', options: ['spur', 'helical', 'bevel', 'worm', 'planetary'], default: 'spur' },
    { key: 'material', label: 'Material', type: 'select', options: ['steel', 'stainless', 'cast_iron', 'bronze', 'plastic'], default: 'steel' },
    { key: 'load_factor', label: 'Load factor', type: 'number', default: 1.0, min: 0 },
    { key: 'speed_factor', label: 'Speed factor', type: 'number', default: 1.0, min: 0 },
    { key: 'alignment_factor', label: 'Alignment factor', type: 'number', default: 1.0, min: 0 },
    { key: 'lubrication', label: 'Lubrication', type: 'select', options: ['oil_bath', 'splash', 'grease', 'dry'], default: 'oil_bath' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  seal: [
    { key: 'seal_type', label: 'Type', type: 'select', options: ['o_ring', 'lip', 'mechanical', 'gasket', 'labyrinth'], default: 'o_ring' },
    { key: 'material', label: 'Material', type: 'select', options: ['nitrile', 'viton', 'silicone', 'ptfe', 'epdm'], default: 'nitrile' },
    { key: 'pressure_psi', label: 'Pressure (psi)', type: 'number', default: 100, min: 0 },
    { key: 'fluid', label: 'Fluid', type: 'select', options: ['oil', 'water', 'air', 'gas', 'chemical'], default: 'oil' },
    { key: 'surface_finish', label: 'Surface finish factor', type: 'number', default: 1.0, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 25 },
  ],
  valve: [
    { key: 'valve_type', label: 'Type', type: 'select', options: ['ball', 'gate', 'globe', 'butterfly', 'check', 'relief', 'solenoid', 'pneumatic'], default: 'ball' },
    { key: 'fluid', label: 'Fluid', type: 'select', options: ['oil', 'water', 'air', 'gas', 'steam', 'chemical'], default: 'oil' },
    { key: 'pressure_psi', label: 'Pressure (psi)', type: 'number', default: 100, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 25 },
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, min: 0 },
  ],
  actuator: [
    { key: 'actuator_type', label: 'Type', type: 'select', options: ['hydraulic', 'pneumatic', 'electric_linear', 'electric_rotary'], default: 'hydraulic' },
    { key: 'pressure_psi', label: 'Pressure (psi)', type: 'number', default: 1000, min: 0 },
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 10, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  pump: [
    { key: 'pump_type', label: 'Type', type: 'select', options: ['centrifugal', 'piston', 'gear', 'vane', 'diaphragm', 'peristaltic'], default: 'centrifugal' },
    { key: 'flow_factor', label: 'Flow factor', type: 'number', default: 1.0, min: 0 },
    { key: 'speed_rpm', label: 'Speed (RPM)', type: 'number', default: 1800, min: 0 },
    { key: 'pressure_psi', label: 'Pressure (psi)', type: 'number', default: 100, min: 0 },
    { key: 'fluid', label: 'Fluid', type: 'select', options: ['oil', 'water', 'air', 'gas', 'chemical', 'slurry'], default: 'water' },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 30 },
    { key: 'contamination', label: 'Contamination', type: 'select', options: ['clean', 'moderate', 'dirty'], default: 'clean' },
  ],
  filter_mech: [
    { key: 'filter_type', label: 'Type', type: 'select', options: ['hydraulic', 'fuel', 'air', 'water'], default: 'hydraulic' },
    { key: 'differential_pressure_factor', label: 'Differential pressure factor', type: 'number', default: 1.0, min: 0 },
    { key: 'fluid_factor', label: 'Fluid factor', type: 'number', default: 1.0, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 30 },
  ],
  coupling: [
    { key: 'coupling_type', label: 'Type', type: 'select', options: ['rigid', 'flexible', 'fluid', 'gear', 'universal'], default: 'flexible' },
    { key: 'torque_factor', label: 'Torque factor', type: 'number', default: 1.0, min: 0 },
    { key: 'alignment_factor', label: 'Alignment factor', type: 'number', default: 1.0, min: 0 },
    { key: 'speed_rpm', label: 'Speed (RPM)', type: 'number', default: 1800, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  brake_clutch: [
    { key: 'device_type', label: 'Type', type: 'select', options: ['drum_brake', 'disc_brake', 'band_brake', 'friction_clutch', 'magnetic_clutch'], default: 'disc_brake' },
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 10, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 60 },
  ],
  electric_motor: [
    { key: 'motor_type', label: 'Type', type: 'select', options: ['ac_induction', 'ac_synchronous', 'dc_brushed', 'dc_brushless', 'stepper'], default: 'ac_induction' },
    { key: 'power_hp', label: 'Power (HP)', type: 'number', default: 1.0, min: 0 },
    { key: 'voltage_stress', label: 'Voltage stress ratio', type: 'number', default: 1.0, min: 0 },
    { key: 'altitude_ft', label: 'Altitude (ft)', type: 'number', default: 0, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
  belt_chain: [
    { key: 'type', label: 'Type', type: 'select', options: ['v_belt', 'timing_belt', 'flat_belt', 'roller_chain', 'silent_chain'], default: 'v_belt' },
    { key: 'load_factor', label: 'Load factor', type: 'number', default: 1.0, min: 0 },
    { key: 'speed_rpm', label: 'Speed (RPM)', type: 'number', default: 1800, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 30 },
  ],
  hydraulic_line: [
    { key: 'line_type', label: 'Type', type: 'select', options: ['rigid_pipe', 'flexible_hose', 'tubing', 'fitting'], default: 'rigid_pipe' },
    { key: 'material', label: 'Material', type: 'select', options: ['steel', 'stainless', 'aluminum', 'copper', 'rubber', 'ptfe'], default: 'steel' },
    { key: 'pressure_psi', label: 'Pressure (psi)', type: 'number', default: 500, min: 0 },
    { key: 'fluid', label: 'Fluid', type: 'select', options: ['oil', 'water', 'air', 'gas', 'hydraulic_fluid', 'fuel'], default: 'hydraulic_fluid' },
    { key: 'n_bends', label: 'Number of bends', type: 'number', default: 0, min: 0 },
    { key: 'temperature', label: 'Temperature (°C)', type: 'number', default: 40 },
  ],
}
const NSWC_ENVIRONMENTS = [
  { code: 'indoor', label: 'Indoor' },
  { code: 'outdoor', label: 'Outdoor' },
  { code: 'naval', label: 'Naval' },
  { code: 'airborne', label: 'Airborne' },
  { code: 'missile', label: 'Missile' },
  { code: 'space', label: 'Space' },
]

// --- NPRD / EPRD (empirical RIAC databases) -------------------------------
// These are data-driven look-ups: each part takes a sub-type plus an
// environment and a quality/data-confidence level.
const RIAC_QUALITY: Field = {
  key: 'quality', label: 'Quality / data grade', type: 'select',
  options: ['high', 'commercial', 'unknown', 'lower'], default: 'commercial',
}
const RIAC_ENVIRONMENTS = [
  { code: 'GB', label: 'GB — Ground, Benign' },
  { code: 'GF', label: 'GF — Ground, Fixed' },
  { code: 'GM', label: 'GM — Ground, Mobile' },
  { code: 'NS', label: 'NS — Naval, Sheltered' },
  { code: 'NU', label: 'NU — Naval, Unsheltered' },
  { code: 'AIC', label: 'AIC — Airborne, Inhabited Cargo' },
  { code: 'AIF', label: 'AIF — Airborne, Inhabited Fighter' },
  { code: 'ARW', label: 'ARW — Airborne, Rotary Wing' },
  { code: 'SF', label: 'SF — Space, Flight' },
  { code: 'MF', label: 'MF — Missile, Flight' },
  { code: 'CL', label: 'CL — Cannon, Launch' },
]

const EPRD_LABELS: Record<string, string> = {
  eprd_capacitor: 'Capacitor', eprd_resistor: 'Resistor', eprd_inductor: 'Inductor / Transformer',
  eprd_diode: 'Diode', eprd_transistor: 'Transistor', eprd_microcircuit: 'Microcircuit (IC)',
  eprd_optoelectronic: 'Optoelectronic', eprd_relay: 'Relay', eprd_connector: 'Connector',
  eprd_switch: 'Switch',
}
const EPRD_FIELDS: Record<string, Field[]> = {
  eprd_capacitor: [{ key: 'cap_type', label: 'Type', type: 'select', options: ['ceramic', 'ceramic_chip', 'tantalum_solid', 'tantalum_wet', 'aluminum_electrolytic', 'film', 'mica', 'glass', 'variable'], default: 'ceramic' }, RIAC_QUALITY],
  eprd_resistor: [{ key: 'resistor_type', label: 'Type', type: 'select', options: ['film', 'composition', 'wirewound', 'wirewound_power', 'network', 'chip', 'variable', 'thermistor'], default: 'film' }, RIAC_QUALITY],
  eprd_inductor: [{ key: 'inductor_type', label: 'Type', type: 'select', options: ['fixed', 'rf_coil', 'power_transformer', 'pulse_transformer', 'audio_transformer', 'choke'], default: 'fixed' }, RIAC_QUALITY],
  eprd_diode: [{ key: 'diode_type', label: 'Type', type: 'select', options: ['signal', 'rectifier', 'zener', 'schottky', 'power', 'transient_suppressor'], default: 'signal' }, RIAC_QUALITY],
  eprd_transistor: [{ key: 'transistor_type', label: 'Type', type: 'select', options: ['bjt_signal', 'bjt_power', 'fet_signal', 'fet_power', 'mosfet', 'igbt'], default: 'bjt_signal' }, RIAC_QUALITY],
  eprd_microcircuit: [{ key: 'ic_type', label: 'Type', type: 'select', options: ['digital_logic', 'linear', 'memory', 'microprocessor', 'mixed_signal', 'fpga', 'hybrid'], default: 'digital_logic' }, RIAC_QUALITY],
  eprd_optoelectronic: [{ key: 'opto_type', label: 'Type', type: 'select', options: ['led', 'photodiode', 'phototransistor', 'optocoupler', 'laser_diode', 'display'], default: 'led' }, RIAC_QUALITY],
  eprd_relay: [{ key: 'relay_type', label: 'Type', type: 'select', options: ['general_purpose', 'signal', 'power', 'latching', 'solid_state', 'time_delay'], default: 'general_purpose' }, RIAC_QUALITY],
  eprd_connector: [{ key: 'connector_type', label: 'Type', type: 'select', options: ['circular', 'rectangular', 'rf_coaxial', 'pcb_edge', 'ribbon', 'ic_socket', 'power'], default: 'circular' }, RIAC_QUALITY],
  eprd_switch: [{ key: 'switch_type', label: 'Type', type: 'select', options: ['toggle', 'pushbutton', 'rotary', 'slide', 'dip', 'thumbwheel', 'sensitive'], default: 'toggle' }, RIAC_QUALITY],
}

const NPRD_LABELS: Record<string, string> = {
  nprd_motor: 'Electric Motor', nprd_pump: 'Pump', nprd_valve: 'Valve', nprd_actuator: 'Actuator',
  nprd_bearing: 'Bearing', nprd_gear: 'Gear', nprd_fan: 'Fan / Blower', nprd_battery: 'Battery',
  nprd_filter: 'Filter', nprd_sensor: 'Sensor', nprd_switch: 'Switch', nprd_relay: 'Relay',
  nprd_connector: 'Connector', nprd_generic: 'Generic Part',
}
const NPRD_FIELDS: Record<string, Field[]> = {
  nprd_motor: [{ key: 'motor_type', label: 'Type', type: 'select', options: ['ac_induction', 'ac_synchronous', 'dc_brushed', 'dc_brushless', 'stepper', 'servo', 'gearmotor'], default: 'ac_induction' }, RIAC_QUALITY],
  nprd_pump: [{ key: 'pump_type', label: 'Type', type: 'select', options: ['centrifugal', 'gear', 'piston', 'vane', 'diaphragm', 'peristaltic'], default: 'centrifugal' }, RIAC_QUALITY],
  nprd_valve: [{ key: 'valve_type', label: 'Type', type: 'select', options: ['ball', 'gate', 'globe', 'butterfly', 'check', 'relief', 'solenoid', 'needle'], default: 'ball' }, RIAC_QUALITY],
  nprd_actuator: [{ key: 'actuator_type', label: 'Type', type: 'select', options: ['hydraulic', 'pneumatic', 'electric_linear', 'electric_rotary', 'solenoid'], default: 'hydraulic' }, RIAC_QUALITY],
  nprd_bearing: [{ key: 'bearing_type', label: 'Type', type: 'select', options: ['ball', 'roller', 'needle', 'journal', 'sleeve', 'thrust'], default: 'ball' }, RIAC_QUALITY],
  nprd_gear: [{ key: 'gear_type', label: 'Type', type: 'select', options: ['spur', 'helical', 'bevel', 'worm', 'planetary'], default: 'spur' }, RIAC_QUALITY],
  nprd_fan: [{ key: 'fan_type', label: 'Type', type: 'select', options: ['axial', 'centrifugal', 'blower', 'muffin'], default: 'axial' }, RIAC_QUALITY],
  nprd_battery: [{ key: 'battery_type', label: 'Type', type: 'select', options: ['lead_acid', 'nicd', 'nimh', 'lithium_ion', 'lithium_primary', 'alkaline'], default: 'lithium_ion' }, RIAC_QUALITY],
  nprd_filter: [{ key: 'filter_type', label: 'Type', type: 'select', options: ['hydraulic', 'fuel', 'air', 'oil', 'water'], default: 'hydraulic' }, RIAC_QUALITY],
  nprd_sensor: [{ key: 'sensor_type', label: 'Type', type: 'select', options: ['temperature', 'pressure', 'flow', 'position', 'proximity', 'accelerometer', 'level'], default: 'pressure' }, RIAC_QUALITY],
  nprd_switch: [{ key: 'switch_type', label: 'Type', type: 'select', options: ['toggle', 'pushbutton', 'limit', 'pressure', 'rotary', 'micro'], default: 'toggle' }, RIAC_QUALITY],
  nprd_relay: [{ key: 'relay_type', label: 'Type', type: 'select', options: ['general_purpose', 'power', 'contactor', 'latching', 'time_delay'], default: 'general_purpose' }, RIAC_QUALITY],
  nprd_connector: [{ key: 'connector_type', label: 'Type', type: 'select', options: ['circular', 'rectangular', 'power', 'fluid_coupling', 'backshell'], default: 'circular' }, RIAC_QUALITY],
  nprd_generic: [{ key: 'part_class', label: 'Part class', type: 'select', options: ['mechanical_assembly', 'electromechanical', 'heater', 'clutch_brake', 'belt_chain', 'coupling', 'spring', 'seal_gasket', 'hose_line', 'circuit_breaker', 'lamp', 'fuse'], default: 'mechanical_assembly' }, RIAC_QUALITY],
}

const getCategoryFields = (standard: PredictionStandard): Record<string, Field[]> => {
  switch (standard) {
    case 'Telcordia': return TELCORDIA_FIELDS
    case '217Plus': return PLUS217_FIELDS
    case 'FIDES': return FIDES_FIELDS
    case 'NSWC': return NSWC_FIELDS
    case 'EPRD-2014': return EPRD_FIELDS
    case 'NPRD-2023': return NPRD_FIELDS
    default: return MIL_NOTICE2_FIELDS
  }
}

const getCategoryLabels = (standard: PredictionStandard): Record<string, string> => {
  switch (standard) {
    case 'Telcordia': return TELCORDIA_LABELS
    case '217Plus': return PLUS217_LABELS
    case 'FIDES': return FIDES_LABELS
    case 'NSWC': return NSWC_LABELS
    case 'EPRD-2014': return EPRD_LABELS
    case 'NPRD-2023': return NPRD_LABELS
    default: return MIL_NOTICE2_LABELS
  }
}

const getEnvironments = (standard: PredictionStandard) => {
  switch (standard) {
    case 'Telcordia': return TELCORDIA_ENVIRONMENTS
    case 'NSWC': return NSWC_ENVIRONMENTS
    case 'EPRD-2014':
    case 'NPRD-2023': return RIAC_ENVIRONMENTS
    default: return ENVIRONMENTS
  }
}

// --- Cross-standard environment equivalence -------------------------------
// Each standard uses its own environment vocabulary. To carry a chosen
// environment across a standard switch (and to keep mission-phase
// environments valid), codes are mapped through a shared set of canonical
// buckets. NOTE: 'CL' means *Cannon Launch* in MIL-HDBK-217F but
// *Climate-controlled* in Telcordia, so mapping must be semantic, not by
// matching the raw code string.
type EnvVocab = 'mil' | 'telcordia' | 'nswc' | 'riac'

const envVocab = (s: PredictionStandard): EnvVocab =>
  s === 'Telcordia' ? 'telcordia'
    : s === 'NSWC' ? 'nswc'
    : (s === 'EPRD-2014' || s === 'NPRD-2023') ? 'riac'
    : 'mil'

const ENV_TO_CANON: Record<EnvVocab, Record<string, string>> = {
  mil: {
    GB: 'ground_benign', GF: 'ground_fixed', GM: 'ground_mobile',
    NS: 'naval_sheltered', NU: 'naval_unsheltered',
    AIC: 'air_inhabited', AIF: 'air_inhabited',
    AUC: 'air_uninhabited', AUF: 'air_uninhabited', ARW: 'air_uninhabited',
    SF: 'space', MF: 'missile', ML: 'missile', CL: 'cannon',
  },
  telcordia: {
    GC: 'ground_benign', GF: 'ground_fixed', GM: 'ground_mobile',
    CL: 'ground_benign', // Telcordia CL = Climate-controlled ≈ benign
    NU: 'naval_unsheltered', AF: 'air_inhabited', AUF: 'air_uninhabited',
  },
  nswc: {
    indoor: 'ground_benign', outdoor: 'ground_fixed', naval: 'naval_unsheltered',
    airborne: 'air_inhabited', missile: 'missile', space: 'space',
  },
  riac: {
    GB: 'ground_benign', GF: 'ground_fixed', GM: 'ground_mobile',
    NS: 'naval_sheltered', NU: 'naval_unsheltered',
    AIC: 'air_inhabited', AIF: 'air_inhabited', ARW: 'air_uninhabited',
    SF: 'space', MF: 'missile', CL: 'cannon',
  },
}

const CANON_TO_ENV: Record<EnvVocab, Record<string, string>> = {
  mil: {
    ground_benign: 'GB', ground_fixed: 'GF', ground_mobile: 'GM',
    naval_sheltered: 'NS', naval_unsheltered: 'NU',
    air_inhabited: 'AIC', air_uninhabited: 'AUC',
    space: 'SF', missile: 'MF', cannon: 'CL',
  },
  telcordia: {
    ground_benign: 'GC', ground_fixed: 'GF', ground_mobile: 'GM',
    naval_sheltered: 'NU', naval_unsheltered: 'NU',
    air_inhabited: 'AF', air_uninhabited: 'AUF',
    // Telcordia (telecom) has no space/missile/cannon — use harshest airborne.
    space: 'GC', missile: 'AUF', cannon: 'AUF',
  },
  nswc: {
    ground_benign: 'indoor', ground_fixed: 'outdoor', ground_mobile: 'outdoor',
    naval_sheltered: 'naval', naval_unsheltered: 'naval',
    air_inhabited: 'airborne', air_uninhabited: 'airborne',
    space: 'space', missile: 'missile', cannon: 'missile',
  },
  riac: {
    ground_benign: 'GB', ground_fixed: 'GF', ground_mobile: 'GM',
    naval_sheltered: 'NS', naval_unsheltered: 'NU',
    air_inhabited: 'AIC', air_uninhabited: 'ARW',
    space: 'SF', missile: 'MF', cannon: 'CL',
  },
}

/** Map an environment code from one standard's vocabulary to another's,
 *  preserving meaning. Falls back to the target standard's first code. */
const mapEnvironment = (code: string, from: PredictionStandard, to: PredictionStandard): string => {
  const fv = envVocab(from)
  const tv = envVocab(to)
  if (fv === tv) return code
  const canon = ENV_TO_CANON[fv][code]
  const mapped = canon ? CANON_TO_ENV[tv][canon] : undefined
  return mapped ?? getEnvironments(to)[0].code
}

const defaultParamsForStandard = (standard: PredictionStandard, cat: string): Record<string, string | number> => {
  const fields = getCategoryFields(standard)
  const f = fields[cat]
  if (!f) return {}
  return Object.fromEntries(f.map(field => [field.key, field.default]))
}

// --- Cross-standard part-category equivalence ------------------------------
// Maps each standard's part categories onto a small set of canonical part
// types so an existing parts list can be carried across a standard switch
// (preserving common properties) instead of being cleared. NSWC is purely
// mechanical and shares no electronic categories, so its map is empty and
// such parts are preserved unchanged.
const CAT_TO_CANON: Record<PredictionStandard, Record<string, string>> = {
  'MIL-HDBK-217F': {
    microcircuit: 'ic', vhsic_microcircuit: 'ic', gaas_microcircuit: 'ic',
    hybrid_microcircuit: 'ic', bubble_memory: 'ic',
    diode: 'diode', hf_diode: 'diode',
    bjt: 'transistor', fet: 'transistor', unijunction: 'transistor',
    hf_low_noise_bjt: 'transistor', hf_power_bjt: 'transistor',
    gaas_fet: 'transistor', hf_silicon_fet: 'transistor', thyristor: 'transistor',
    optoelectronic: 'optoelectronic', laser_diode: 'optoelectronic',
    resistor: 'resistor', capacitor: 'capacitor',
    transformer: 'inductor', inductor_coil: 'inductor', ferrite_bead: 'inductor', motor: 'rotating',
    relay: 'relay', ss_relay: 'relay', switch: 'switch', circuit_breaker: 'switch',
    connector: 'connector', connector_socket: 'connector', connection: 'connector',
    pth_assembly: 'pcb', surface_mount_assembly: 'pcb', crystal: 'crystal',
    oscillator: 'crystal', mems_oscillator: 'crystal', fuse: 'fuse',
  },
  'Telcordia': {
    ic_digital: 'ic', ic_linear: 'ic', ic_memory: 'ic', ic_microprocessor: 'ic',
    diode: 'diode', transistor_bjt: 'transistor', transistor_fet: 'transistor',
    resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductor', transformer: 'inductor',
    relay: 'relay', switch: 'switch', connector: 'connector', crystal: 'crystal', fuse: 'fuse', pcb: 'pcb',
  },
  '217Plus': {
    microcircuit: 'ic', discrete_semiconductor: 'diode',
    resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductor',
    relay: 'relay', switch: 'switch', connector: 'connector', pcb: 'pcb', crystal: 'crystal', fuse: 'fuse', rotating: 'rotating',
  },
  'FIDES': {
    ic: 'ic', discrete: 'diode',
    passive_resistor: 'resistor', passive_capacitor: 'capacitor', passive_inductor: 'inductor',
    connector: 'connector', pcb: 'pcb', relay: 'relay', switch: 'switch', crystal: 'crystal',
  },
  'NSWC': {},
  'EPRD-2014': {
    eprd_microcircuit: 'ic', eprd_diode: 'diode', eprd_transistor: 'transistor',
    eprd_optoelectronic: 'optoelectronic', eprd_resistor: 'resistor', eprd_capacitor: 'capacitor',
    eprd_inductor: 'inductor', eprd_relay: 'relay', eprd_switch: 'switch', eprd_connector: 'connector',
  },
  'NPRD-2023': {
    nprd_motor: 'rotating', nprd_fan: 'rotating',
    nprd_relay: 'relay', nprd_switch: 'switch', nprd_connector: 'connector',
  },
}

const CANON_TO_CAT: Record<PredictionStandard, Record<string, string>> = {
  'MIL-HDBK-217F': {
    ic: 'microcircuit', diode: 'diode', transistor: 'bjt', optoelectronic: 'optoelectronic',
    resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductor_coil', rotating: 'motor',
    relay: 'relay', switch: 'switch', connector: 'connector', pcb: 'pth_assembly', crystal: 'crystal', fuse: 'fuse',
  },
  'Telcordia': {
    ic: 'ic_digital', diode: 'diode', transistor: 'transistor_bjt',
    resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductor',
    relay: 'relay', switch: 'switch', connector: 'connector', crystal: 'crystal', fuse: 'fuse', pcb: 'pcb',
  },
  '217Plus': {
    ic: 'microcircuit', diode: 'discrete_semiconductor', transistor: 'discrete_semiconductor',
    resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductor',
    relay: 'relay', switch: 'switch', connector: 'connector', pcb: 'pcb', crystal: 'crystal', fuse: 'fuse', rotating: 'rotating',
  },
  'FIDES': {
    ic: 'ic', diode: 'discrete', transistor: 'discrete',
    resistor: 'passive_resistor', capacitor: 'passive_capacitor', inductor: 'passive_inductor',
    connector: 'connector', pcb: 'pcb', relay: 'relay', switch: 'switch', crystal: 'crystal',
  },
  'NSWC': {},
  'EPRD-2014': {
    ic: 'eprd_microcircuit', diode: 'eprd_diode', transistor: 'eprd_transistor',
    optoelectronic: 'eprd_optoelectronic', resistor: 'eprd_resistor', capacitor: 'eprd_capacitor',
    inductor: 'eprd_inductor', relay: 'eprd_relay', switch: 'eprd_switch', connector: 'eprd_connector',
  },
  'NPRD-2023': {
    rotating: 'nprd_motor', relay: 'nprd_relay', switch: 'nprd_switch', connector: 'nprd_connector',
  },
}

// Stress params that share meaning (and key) across standards.
const SHARED_STRESS_KEYS = ['power_stress', 'voltage_stress', 'current_stress']
// Temperature parameter aliases (key differs by standard/category).
const TEMP_PARAM_KEYS = [
  'temperature', 'T_ambient', 'T_junction', 'case_temperature_c',
  'channel_temperature_c', 'T_hotspot', 'frame_temperature', 'T_insert',
]

/** Convert a part to a different standard, carrying over common properties
 *  (name, quantity, notes, shared stress ratios, temperature, environment).
 *  Parts with no equivalent category in the target standard are preserved
 *  unchanged so nothing is silently lost. */
const convertPartToStandard = (
  part: PredictionPart,
  fromStd: PredictionStandard,
  toStd: PredictionStandard,
): PredictionPart => {
  if (fromStd === toStd) return part
  const canon = CAT_TO_CANON[fromStd]?.[part.category]
  const newCat = canon ? CANON_TO_CAT[toStd]?.[canon] : undefined
  const remapEnv = (p: PredictionPart): PredictionPart =>
    p.environment ? { ...p, environment: mapEnvironment(p.environment, fromStd, toStd) } : p
  // No electronic equivalent (e.g. to/from mechanical NSWC): keep as-is.
  if (!newCat) return remapEnv(part)

  const newFields = getCategoryFields(toStd)[newCat] ?? []
  const newKeys = new Set(newFields.map(f => f.key))
  const newParams: Record<string, PredictionParamValue> = defaultParamsForStandard(toStd, newCat)
  const oldParams = part.params ?? {}
  // Carry identically-named params the target category also defines.
  for (const k of Object.keys(oldParams)) {
    if (newKeys.has(k)) newParams[k] = oldParams[k]
  }
  // Carry shared stress ratios explicitly.
  for (const k of SHARED_STRESS_KEYS) {
    if (k in oldParams && newKeys.has(k)) newParams[k] = oldParams[k]
  }
  // Carry temperature across differing key names.
  const oldTempKey = TEMP_PARAM_KEYS.find(k => k in oldParams)
  const newTempKey = newFields.map(f => f.key).find(k => TEMP_PARAM_KEYS.includes(k))
  if (oldTempKey && newTempKey) newParams[newTempKey] = oldParams[oldTempKey]

  return {
    ...part,
    category: newCat,
    params: newParams,
    environment: part.environment ? mapEnvironment(part.environment, fromStd, toStd) : part.environment,
  }
}

/** Distinguish real equations from trace metadata such as "Table 9.1 lookup".
 * KaTeX intentionally ignores ordinary spaces, so rendering prose as math is
 * what produced strings such as "Section9.1styletable". */
function looksLikeEquation(expression: string): boolean {
  const value = expression.trim()
  if (!value) return false
  if (/^(section|appendix|table)\b/i.test(value)) return false
  if (/\b(table lookup|lookup by|column equation|piecewise equation|empirical equation|technology-specific|user-supplied| or )\b/i.test(value)) return false
  if (/[:;]/.test(value) && /^[A-Za-z]/.test(value)) return false
  return /[=+*/^()[\]λπηβΣ]|\b(exp|max|min|ln|sqrt)\b/.test(value)
}

function CalculationExpression({ expression, latex, bindings, onBindingHover }: {
  expression: string
  latex?: string
  bindings?: EquationSymbolBinding[]
  onBindingHover?: (binding: EquationSymbolBinding | null) => void
}) {
  if (latex) {
    return <div className="overflow-x-auto text-gray-800">
      <Latex block bindings={bindings} onBindingHover={onBindingHover}>{latex}</Latex>
    </div>
  }
  if (looksLikeEquation(expression)) {
    return <div className="overflow-x-auto text-gray-800">
      <Latex block bindings={bindings} onBindingHover={onBindingHover}>{formulaToLatex(expression)}</Latex>
    </div>
  }
  return (
    <p className="text-gray-700 leading-relaxed">
      <span className="font-medium text-gray-500">Model rule: </span>{expression}
    </p>
  )
}

function PartsCountTypePicker({ value, catalog, onChange }: {
  value: string
  catalog: PartsCountCatalogEntry[]
  onChange: (value: string) => void
}) {
  const groupFor = (entry: PartsCountCatalogEntry | undefined) =>
    entry ? (PARTS_COUNT_GROUP_BY_FAMILY[entry.family] ?? 'Other components') : undefined
  const currentEntry = catalog.find(entry => entry.key === value)
  const availableGroups = PARTS_COUNT_GROUP_ORDER.filter(group =>
    catalog.some(entry => groupFor(entry) === group))
  const [group, setGroup] = useState(groupFor(currentEntry) ?? availableGroups[0] ?? '')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const currentGroup = groupFor(catalog.find(entry => entry.key === value))
    if (currentGroup) setGroup(currentGroup)
  }, [catalog, value])

  const candidates = catalog.filter(entry => groupFor(entry) === group)
  const normalizedQuery = query.trim().toLowerCase()
  const matches = candidates.filter(entry => !normalizedQuery ||
    entry.label.toLowerCase().includes(normalizedQuery) ||
    entry.key.toLowerCase().includes(normalizedQuery) ||
    entry.section.toLowerCase().includes(normalizedQuery))
  const displayedValue = matches.some(entry => entry.key === value) ? value : ''

  if (!catalog.length) {
    return (
      <select disabled className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-400">
        <option>Loading Appendix A catalog…</option>
      </select>
    )
  }

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-2 space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <select value={group} aria-label="Parts-count component family"
          onChange={e => {
            const nextGroup = e.target.value
            setGroup(nextGroup)
            setQuery('')
            const first = catalog.find(entry => groupFor(entry) === nextGroup)
            if (first) onChange(first.key)
          }}
          className="min-w-0 rounded border border-gray-300 bg-white px-1.5 py-1 text-[10px] focus:border-blue-400 focus:outline-none">
          {availableGroups.map(optionGroup => (
            <option key={optionGroup} value={optionGroup}>{optionGroup}</option>
          ))}
        </select>
        <div className="relative">
          <Search size={11} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            aria-label="Filter parts-count part types" placeholder="Filter part types…"
            className="w-full rounded border border-gray-300 bg-white py-1 pl-5 pr-1.5 text-[10px] focus:border-blue-400 focus:outline-none" />
        </div>
      </div>
      <select value={displayedValue} aria-label="Appendix A part type"
        onChange={e => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none">
        {!displayedValue && <option value="" disabled>{matches.length ? 'Select a matching part type…' : 'No matching part types'}</option>}
        {matches.map(entry => (
          <option key={entry.key} value={entry.key}>{entry.label} (§{entry.section})</option>
        ))}
      </select>
      <p className="text-[9px] text-gray-400">{matches.length} of {candidates.length} types in this family</p>
    </div>
  )
}

const ENV_DESCRIPTIONS: Record<string, string> = {
  GB: 'πE affects all MIL-HDBK-217F parts. Ground, Benign is the baseline (lowest stress).',
  GF: 'πE ≈ 2–6× baseline. Fixed ground installation with climate control.',
  GM: 'πE ≈ 5–16×. Mobile ground equipment subject to vibration and temperature extremes.',
  NS: 'πE ≈ 4–9×. Sheltered naval installation (below deck).',
  NU: 'πE ≈ 5–13×. Unsheltered naval (exposed to salt spray, humidity, and temperature).',
  AIC: 'πE ≈ 4–9×. Inhabited cargo aircraft (pressurized, vibration).',
  AIF: 'πE ≈ 5–12×. Inhabited fighter aircraft (high vibration, g-forces).',
  AUC: 'πE ≈ 6–13×. Uninhabited cargo area (unpressurized, wider temperature range).',
  AUF: 'πE ≈ 7–16×. Uninhabited fighter area (extreme vibration and temperature).',
  ARW: 'πE ≈ 8–18×. Rotary-wing aircraft (high vibration from rotor).',
  SF: 'πE ≈ 0.5–2×. Space flight (vacuum, radiation, but no vibration after launch).',
  MF: 'πE ≈ 9–25×. Missile flight environment (extreme short-duration stress).',
  ML: 'πE ≈ 12–46×. Missile launch (extreme shock and vibration).',
  CL: 'πE ≈ 300–600×. Cannon launch — highest stress environment in MIL-HDBK-217F.',
}

const defaultParams = (category: string): Record<string, string | number> =>
  Object.fromEntries(MIL_NOTICE2_FIELDS[category].map(f => [f.key, f.default]))

/** A container in the system breakdown hierarchy. */
interface SystemBlock {
  id: string        // unique, e.g. 'b1', 'b2'
  name: string
  parentId: string | null  // parent block id, null = root level
  environment?: string | null  // override environment for this block
  nonoperatingEnvironment?: string | null
  nonoperatingTemperatureC?: number | null
  powerCyclesPer1000NonoperatingHours?: number | null
  quantity?: number
  operatingFraction?: number
  notes?: string
  failureRateOverrideEnabled?: boolean
  failureRateOverrideFpmh?: number | null
}

interface NonoperatingModelDefinition {
  section: string
  required_parameters: string[]
  conditional_parameters?: Record<string, string>
  choices?: Record<string, string[]>
}

const RADC_CONTEXT_PARAMETERS = new Set([
  'environment', 'temperature_c', 'power_cycles_per_1000h',
])

const RADC_NUMERIC_PARAMETERS = new Set([
  'complexity', 'diodes', 'transistors', 'integrated_circuits',
  'transfer_gates', 'dissipative_control_gates', 'major_loops',
  'functional_minor_loops', 'active_optical_surfaces',
  'contact_voltage_mv', 'functional_pths', 'fiber_length_km',
])

const RADC_PARAMETER_LABELS: Record<string, string> = {
  complexity: 'Gate / transistor count',
  technology: 'RADC technology',
  package: 'Package hermeticity',
  quality: 'RADC quality level',
  diodes: 'Discrete diodes in hybrid',
  transistors: 'Discrete transistors in hybrid',
  integrated_circuits: 'Integrated circuits in hybrid',
  transfer_gates: 'Transfer gates',
  dissipative_control_gates: 'Dissipative control gates',
  major_loops: 'Major loops',
  functional_minor_loops: 'Functional minor loops',
  part_type: 'RADC part type',
  tube_type: 'RADC tube type',
  laser_type: 'RADC laser type',
  active_optical_surfaces: 'Active optical surfaces',
  style: 'RADC style',
  package_type: 'Package hermeticity',
  contact_voltage_mv: 'Open-contact voltage (mV)',
  connector_type: 'RADC connector type',
  functional_pths: 'Functional plated-through holes',
  fiber_length_km: 'Fiber length (km)',
}

interface PredictionState {
  environment: string
  vitaGlobal: boolean
  missionHours: string
  failureRateUnit?: 'per_hour' | 'fpmh' | 'fit'
  parts: PredictionPart[]
  blocks: SystemBlock[]
  blockSeq: number   // for generating unique block ids
  contributionScope?: 'system' | 'blocks'
  contributionBlockIds?: string[]
  result?: PredictionResponse | null
  deratingStandard?: string
  deratingLevel?: 'I' | 'II' | 'III'
  deratingEnabled?: boolean
  customRules?: Record<string, CustomDeratingRule[]>
  deratingResult?: DeratingResponse | null
}

const INITIAL_STATE: PredictionState = {
  environment: 'GB',
  vitaGlobal: false,
  missionHours: '8760',
  failureRateUnit: 'fpmh',
  parts: [],
  blocks: [],
  blockSeq: 0,
  contributionScope: 'system',
  contributionBlockIds: [],
  deratingStandard: 'MIL-STD-975M',
  deratingLevel: 'II',
  deratingEnabled: false,
  customRules: {},
  deratingResult: null,
}

/** Per-part VITA override cycle: inherit (null) -> on (true) -> off (false). */
const nextVita = (v: boolean | null | undefined): boolean | null =>
  v == null ? true : v ? false : null

export default function Prediction() {
  const [state, setState, folios] = useFolioState<PredictionState>('prediction', INITIAL_STATE)
  const { environment, vitaGlobal, missionHours, parts } = state
  const failureRateUnit = state.failureRateUnit ?? 'fpmh'
  const failureRateUnitLabel = failureRateUnit === 'per_hour'
    ? 'failures/hour' : failureRateUnit === 'fit' ? 'FIT' : 'FPMH'
  const scaleFailureRate = (value: number) => failureRateUnit === 'per_hour'
    ? value / 1_000_000 : failureRateUnit === 'fit' ? value * 1_000 : value
  const formatFailureRate = (value: number | null | undefined, digits = 5) => {
    if (value == null) return 'Unavailable'
    const scaled = scaleFailureRate(value)
    return failureRateUnit === 'per_hour'
      ? scaled.toExponential(Math.max(1, digits - 1))
      : scaled.toFixed(digits)
  }
  const blocks = state.blocks
  const blockSeq = state.blockSeq
  const contributionScope = state.contributionScope === 'blocks' && blocks.length > 0 ? 'blocks' : 'system'
  const contributionBlockIds = (state.contributionBlockIds ?? []).filter(id => blocks.some(b => b.id === id))
  const result = state.result ?? null

  // Prediction standard selector
  const [standard, setStandard] = useState<PredictionStandard>('MIL-HDBK-217F')
  const helpStandard: Record<PredictionStandard, string> = {
    'MIL-HDBK-217F': 'mil-hdbk-217f',
    Telcordia: 'telcordia-sr332',
    '217Plus': '217plus',
    FIDES: 'fides',
    NSWC: 'nswc-98-le1',
    'EPRD-2014': 'eprd-2014',
    'NPRD-2023': 'nprd-2023',
  }
  useHelpTopic(`prediction.${helpStandard[standard]}`)
  const [processGrade, setProcessGrade] = useState(3)
  const [processScore, setProcessScore] = useState(50)

  // Part editor (transient)
  const [category, setCategory] = useState('microcircuit')
  const [partName, setPartName] = useState('')
  const [partNumber, setPartNumber] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [editorVita, setEditorVita] = useState<'inherit' | 'on' | 'off'>('inherit')
  const [editorMultiplier, setEditorMultiplier] = useState('1')
  const [editorParentId, setEditorParentId] = useState('')
  const [editorEnv, setEditorEnv] = useState('')
  const [params, setParams] = useState<Record<string, string | number>>(
    defaultParams('microcircuit'))

  // System block editor (transient)
  const [blockName, setBlockName] = useState('')
  const [blockParentId, setBlockParentId] = useState('')

  const [selectedPartIdx, setSelectedPartIdx] = useState<number | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [activeParameter, setActiveParameter] = useState<{
    partIndex: number
    key: string
  } | null>(null)
  const [hoveredEquationFactorKey, setHoveredEquationFactorKey] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Derating
  const deratingRequestSeq = useRef(0)
  const activeFolioIdRef = useRef(folios.activeId)
  activeFolioIdRef.current = folios.activeId
  const [deratingLoading, setDeratingLoading] = useState(false)
  const [deratingError, setDeratingError] = useState<string | null>(null)
  const [showAllDeratingInputs, setShowAllDeratingInputs] = useState(false)
  const deratingResult = state.deratingResult ?? null
  const deratingEnabled = state.deratingEnabled === true
  const deratingLevel = state.deratingLevel ?? 'II'
  const deratingStandard = state.deratingStandard ?? 'MIL-STD-975M'
  const customRules = state.customRules ?? {}
  const setDeratingStandard = (value: string) => {
    deratingRequestSeq.current += 1
    setDeratingLoading(false)
    setDeratingError(null)
    setShowAllDeratingInputs(false)
    setState(current => ({
      ...current,
      deratingStandard: value,
      deratingResult: null,
    }))
  }
  const setDeratingLevel = (value: string) => {
    deratingRequestSeq.current += 1
    setDeratingLoading(false)
    setDeratingError(null)
    setState(current => ({
      ...current,
      deratingLevel: value as 'I' | 'II' | 'III',
      deratingResult: null,
    }))
  }
  const setDeratingEnabled = (value: boolean) => {
    deratingRequestSeq.current += 1
    setDeratingLoading(false)
    setDeratingError(null)
    setShowAllDeratingInputs(false)
    setState(current => ({
      ...current,
      deratingEnabled: value,
      deratingResult: null,
    }))
  }
  const setCustomRules = (value: Record<string, CustomDeratingRule[]>) => {
    deratingRequestSeq.current += 1
    setDeratingLoading(false)
    setDeratingError(null)
    setState(current => ({
      ...current,
      customRules: value,
      deratingResult: null,
    }))
  }
  const [deratingStandards, setDeratingStandards] = useState<DeratingStandard[]>([])
  const [customRulesOpen, setCustomRulesOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryGroup, setLibraryGroup] = useState('All')
  const [partEditorOpen, setPartEditorOpen] = useState(false)
  const [blockEditorOpen, setBlockEditorOpen] = useState(false)

  // Mission Profile
  const [missionPhases, setMissionPhases] = useState<MissionPhaseInput[]>([])
  const [missionResult, setMissionResult] = useState<MissionProfileResponse | null>(null)
  const [missionOpen, setMissionOpen] = useState(false)
  const [missionProfileName, setMissionProfileName] = useState('Custom Mission')
  const [presetProfiles, setPresetProfiles] = useState<Record<string, { name: string; phases: MissionPhaseInput[] }>>({})
  const [standardMethods, setStandardMethods] = useState<Record<string, { methodology: MethodologyDisclosure }>>({})
  const [partsCountCatalog, setPartsCountCatalog] = useState<PartsCountCatalogEntry[]>([])
  const [nonoperatingEnvironments, setNonoperatingEnvironments] = useState<
    { code: string; description: string }[]
  >([])
  const [nonoperatingModels, setNonoperatingModels] = useState<
    Record<string, NonoperatingModelDefinition>
  >({})
  const [automaticNonoperatingModels, setAutomaticNonoperatingModels] = useState<
    Record<string, { model: string; input_keys: string[] }>
  >({})

  useEffect(() => {
    getMissionProfiles().then(setPresetProfiles).catch(() => {})
    getDeratingStandards().then(setDeratingStandards).catch(() => {})
    getPredictionStandards().then(setStandardMethods).catch(() => {})
    getPartsCountCatalog().then(catalog => setPartsCountCatalog(catalog.parts)).catch(() => {})
    getPredictionOptions()
      .then(options => {
        setNonoperatingEnvironments(options.nonoperating_environments)
        setNonoperatingModels(options.nonoperating_models)
        setAutomaticNonoperatingModels(options.nonoperating_automatic_models)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    // An in-flight result belongs to the analysis on which it started. Never
    // let it write into a newly selected analysis.
    deratingRequestSeq.current += 1
    setDeratingLoading(false)
    setDeratingError(null)
  }, [folios.activeId])

  useEffect(() => {
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveParameter(null)
    }
    window.addEventListener('keydown', clearOnEscape)
    return () => window.removeEventListener('keydown', clearOnEscape)
  }, [])

  const partsCountEntry = (partType: PredictionParamValue | undefined) =>
    partsCountCatalog.find(entry => entry.key === String(partType ?? ''))

  const partsCountOptionGroups = useMemo(() => {
    const grouped = new Map<string, PartsCountCatalogEntry[]>()
    for (const entry of partsCountCatalog) {
      const group = PARTS_COUNT_GROUP_BY_FAMILY[entry.family] ?? 'Other components'
      if (!grouped.has(group)) grouped.set(group, [])
      grouped.get(group)!.push(entry)
    }
    return PARTS_COUNT_GROUP_ORDER
      .map(group => ({ group, entries: grouped.get(group) ?? [] }))
      .filter(({ entries }) => entries.length > 0)
  }, [partsCountCatalog])

  const categoryGroups = useMemo(() => {
    const available = getCategoryFields(standard)
    const seen = new Set<string>()
    const groups = paletteGroupsFor(standard).map(({ group, items }) => {
      const categories = items
        .map(item => item.category)
        .filter((itemCategory, index, all) =>
          itemCategory in available && all.indexOf(itemCategory) === index && !seen.has(itemCategory))
      categories.forEach(itemCategory => seen.add(itemCategory))
      return { group, categories }
    }).filter(({ categories }) => categories.length > 0)
    const remaining = Object.keys(available).filter(itemCategory => !seen.has(itemCategory))
    if (remaining.length > 0) groups.push({ group: 'Other', categories: remaining })
    return groups
  }, [standard])

  const paletteGroups = useMemo(() => paletteGroupsFor(standard), [standard])
  const visiblePaletteGroups = useMemo(() => {
    const query = librarySearch.trim().toLowerCase()
    return paletteGroups
      .filter(({ group }) => libraryGroup === 'All' || group === libraryGroup)
      .map(({ group, items }) => ({
        group,
        items: items.filter(item => !query ||
          item.label.toLowerCase().includes(query) ||
          (getCategoryLabels(standard)[item.category] ?? '').toLowerCase().includes(query)),
      }))
      .filter(({ items }) => items.length > 0)
  }, [libraryGroup, librarySearch, paletteGroups, standard])

  const selectOptions = (
    partCategory: string,
    partParams: Record<string, PredictionParamValue>,
    field: Field,
  ): string[] => {
    if (partCategory === 'parts_count' && field.key === 'part_type' && partsCountCatalog.length) {
      return partsCountCatalog.map(entry => entry.key)
    }
    if (partCategory === 'parts_count' && field.key === 'quality') {
      return partsCountEntry(partParams.part_type)?.quality_options ?? field.options ?? []
    }
    return field.options ?? []
  }

  const selectOptionLabel = (
    partCategory: string,
    partParams: Record<string, PredictionParamValue>,
    field: Field,
    option: string,
  ) => {
    if (partCategory === 'parts_count' && field.key === 'part_type') {
      const entry = partsCountCatalog.find(candidate => candidate.key === option)
      if (entry) return `${entry.label} (§${entry.section})`
    }
    if (field.key === 'style') {
      const description = partCategory === 'resistor'
        ? RESISTOR_STYLE_LABELS[option]
        : partCategory === 'capacitor' ? CAPACITOR_STYLE_LABELS[option] : undefined
      if (description) return `${option} — ${description}`
    }
    const partsCountMicrocircuit = partCategory === 'parts_count'
      && partsCountEntry(partParams.part_type)?.family === 'microcircuit'
    if (field.key === 'quality'
        && (MIL_MICRO_QUALITY_CATEGORIES.has(partCategory) || partsCountMicrocircuit)) {
      const description = MIL_MICRO_QUALITY_LABELS[option]
      if (description) return description
    }
    if (option === 'true') return 'Yes'
    if (option === 'false') return 'No'
    return option.includes('_') || OPTION_ACRONYMS[option.toLowerCase()]
      ? humanizeOption(option)
      : option
  }

  const renderSelectOptions = (
    partCategory: string,
    partParams: Record<string, PredictionParamValue>,
    field: Field,
  ) => {
    if (partCategory === 'parts_count' && field.key === 'part_type' && partsCountOptionGroups.length) {
      return partsCountOptionGroups.map(({ group, entries }) => (
        <optgroup key={group} label={group}>
          {entries.map(entry => (
            <option key={entry.key} value={entry.key}>{entry.label} (§{entry.section})</option>
          ))}
        </optgroup>
      ))
    }
    return selectOptions(partCategory, partParams, field).map(option => (
      <option key={option} value={option}>{selectOptionLabel(partCategory, partParams, field, option)}</option>
    ))
  }

  const patch = (p: Partial<PredictionState>) => setState(s => ({ ...s, ...p }))
  // Any change to inputs invalidates the previous run
  const patchInputs = (p: Partial<PredictionState>) => {
    deratingRequestSeq.current += 1
    setDeratingLoading(false)
    setDeratingError(null)
    setState(s => ({
      ...s,
      ...p,
      result: null,
      deratingResult: null,
    }))
  }

  const changeStandard = (s: PredictionStandard) => {
    if (s === standard) return
    // Different standards use different part categories, so an existing
    // parts list defined under one standard generally is not valid under
    // another. Warn before switching and never silently discard parts.
    const prevStandard = standard
    if (parts.length > 0) {
      // Pre-compute how many parts have an equivalent category in the target
      // standard so the prompt can be specific.
      const mappable = parts.filter(p => {
        const canon = CAT_TO_CANON[prevStandard]?.[p.category]
        return canon != null && CANON_TO_CAT[s]?.[canon] != null
      }).length
      const unmapped = parts.length - mappable
      const ok = window.confirm(
        `You have ${parts.length} part${parts.length !== 1 ? 's' : ''} defined under ` +
        `${STANDARD_INFO[standard].name}.\n\n` +
        `Switching to ${STANDARD_INFO[s].name} will carry over common properties ` +
        `(category, quantity, stress ratios, temperature, environment) for ${mappable} ` +
        `part${mappable !== 1 ? 's' : ''}` +
        (unmapped > 0
          ? `, and keep ${unmapped} part${unmapped !== 1 ? 's' : ''} with no equivalent category ` +
            `unchanged for you to re-define.`
          : `.`) +
        `\n\nFor a clean parts list under a different standard, consider creating a NEW ` +
        `Analysis from the folio bar instead. Switch here anyway?`
      )
      if (!ok) return
    }
    setStandard(s)
    setActiveParameter(null)
    setLibraryGroup('All')
    setLibrarySearch('')
    const fields = getCategoryFields(s)
    const cats = Object.keys(fields)
    const firstCat = cats[0] ?? 'microcircuit'
    setCategory(firstCat)
    setParams(defaultParamsForStandard(s, firstCat))
    // Convert each part to the new standard, carrying over common properties;
    // remap the global environment; invalidate the (now stale) result.
    patchInputs({
      result: null,
      environment: mapEnvironment(environment, prevStandard, s),
      parts: parts.map(p => convertPartToStandard(p, prevStandard, s)),
      blocks: blocks.map(block => s !== 'MIL-HDBK-217F' ? {
        ...block,
        operatingFraction: 1,
        environment: null,
        nonoperatingEnvironment: null,
        nonoperatingTemperatureC: null,
        powerCyclesPer1000NonoperatingHours: null,
      } : {
        ...block,
        environment: block.environment
          ? mapEnvironment(block.environment, prevStandard, s) : null,
      }),
    })
    // Keep every mission phase on a valid environment for the new standard.
    setMissionPhases(phases =>
      phases.map(ph => s === 'MIL-HDBK-217F' ? {
        ...ph,
        environment: mapEnvironment(ph.environment, prevStandard, s),
      } : {
        ...ph,
        environment: mapEnvironment(ph.environment, prevStandard, s),
        operating_fraction: 1,
        nonoperating_environment: null,
        nonoperating_temperature_c: null,
        power_cycles_per_1000_nonoperating_hours: null,
      })
    )
  }

  const changeCategory = (c: string) => {
    setCategory(c)
    setEditorVita(VITA_ONLY_CATEGORIES.has(c) ? 'on' : 'inherit')
    if (standard === 'MIL-HDBK-217F') {
      setParams(defaultParams(c))
    } else {
      setParams(defaultParamsForStandard(standard, c))
    }
  }

  const addPart = () => {
    const qty = parseInt(quantity, 10)
    if (isNaN(qty) || qty < 1) { setError('Quantity must be a positive integer.'); return }
    const mult = parseFloat(editorMultiplier)
    if (isNaN(mult) || mult <= 0) { setError('Multiplier must be > 0.'); return }
    const cleaned: Record<string, PredictionParamValue> = {}
    for (const f of (getCategoryFields(standard)[category] ?? [])) {
      const v = params[f.key]
      if (f.type === 'number') {
        if (f.optional && (v == null || String(v).trim() === '')) continue
        const num = typeof v === 'number' ? v : parseFloat(v)
        if (isNaN(num)) { setError(`Invalid value for ${f.label}.`); return }
        cleaned[f.key] = num
      } else if (f.type === 'text') {
        const raw = String(v ?? '').trim()
        if (f.optional && raw === '') continue
        if (f.key === 'temperature_profile') {
          try {
            const parsed = JSON.parse(raw)
            const valid = Array.isArray(parsed) && parsed.length > 0 && parsed.every(
              item => Array.isArray(item) && item.length === 2 &&
                item.every(value => typeof value === 'number' && Number.isFinite(value)),
            )
            if (!valid) throw new Error('invalid profile')
            cleaned[f.key] = parsed as [number, number][]
          } catch {
            setError(`${f.label} must be JSON pairs of [hours, temperature °C].`)
            return
          }
        } else {
          cleaned[f.key] = raw
        }
      } else {
        cleaned[f.key] = v
      }
    }
    if (mult !== 1) cleaned.multiplier = mult
    setError(null)
    patchInputs({
      parts: [...parts, {
        category,
        name: partName.trim() || undefined,
        part_number: partNumber.trim() || undefined,
        quantity: qty,
        params: cleaned,
        apply_vita: editorVita === 'inherit' ? null : editorVita === 'on',
        environment: editorEnv || null,
        parentId: editorParentId || selectedBlockId || null,
      }],
    })
    setPartName('')
    setPartNumber('')
  }

  /** Populate a small representative electronics BOM for the current standard,
   *  using each category's default parameters so it predicts out of the box. */
  const loadExample = () => {
    const fields = getCategoryFields(standard)
    const preferred = ['microcircuit', 'resistor', 'capacitor', 'diode', 'bjt']
    let cats = preferred.filter(c => fields[c])
    if (cats.length < 3) cats = Object.keys(fields).slice(0, 5)
    const labels = getCategoryLabels(standard)
    const meta: Record<string, [number, string]> = {
      microcircuit: [2, 'Controller IC'], resistor: [10, 'Resistors'],
      capacitor: [8, 'Capacitors'], diode: [4, 'Rectifier diodes'], bjt: [2, 'Transistors'],
    }
    const exampleParts: PredictionPart[] = cats.map(c => {
      const [qty, nm] = meta[c] ?? [1, labels[c] ?? c]
      return {
        category: c, name: nm, quantity: qty,
        params: defaultParamsForStandard(standard, c),
        apply_vita: null, environment: null, parentId: null,
      }
    })
    patchInputs({ parts: exampleParts, blocks: [], blockSeq: 0 })
  }

  // --- drag-and-drop component palette (#12) ---

  // Active drop target while dragging a palette item: 'root' = top level,
  // a block id = drop inside that block, null = nothing highlighted.
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  /** Build a valid PredictionPart from a palette item, nested under `parentId`. */
  const partFromPalette = (item: PaletteItem, parentId: string | null): PredictionPart => {
    const params = defaultParams(item.category)
    if (item.paramOverrides) Object.assign(params, item.paramOverrides)
    return {
      category: item.category,
      quantity: 1,
      params,
      apply_vita: VITA_ONLY_CATEGORIES.has(item.category) ? true : null,
      environment: null,
      parentId,
    }
  }

  const onPaletteDragStart = (e: React.DragEvent, item: PaletteItem) => {
    e.dataTransfer.setData(PALETTE_DND_TYPE, item.id)
    e.dataTransfer.setData('text/plain', item.label)
    e.dataTransfer.effectAllowed = 'copy'
  }

  /** Whether the current drag carries a palette item we can accept. */
  const isPaletteDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(PALETTE_DND_TYPE)

  const onDropTargetOver = (e: React.DragEvent, target: string) => {
    if (!isPaletteDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (dropTarget !== target) setDropTarget(target)
  }

  /** Drop a palette item onto a target. `target` is 'root' or a block id. */
  const onPaletteDrop = (e: React.DragEvent, target: string) => {
    const id = e.dataTransfer.getData(PALETTE_DND_TYPE)
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const item = paletteGroupsFor(standard)
      .flatMap(g => g.items)
      .find(p => p.id === id)
    if (!item) return
    const parentId = target === 'root' ? null : target
    setError(null)
    patchInputs({ parts: [...parts, partFromPalette(item, parentId)] })
  }

  // --- system blocks ---

  const addBlock = () => {
    const name = blockName.trim()
    if (!name) { setError('Block name is required.'); return }
    setError(null)
    patchInputs({
      blocks: [...blocks, {
        id: `b${blockSeq + 1}`,
        name,
        parentId: blockParentId || null,
        quantity: 1,
        operatingFraction: 1,
        environment: null,
        nonoperatingEnvironment: null,
        nonoperatingTemperatureC: null,
        powerCyclesPer1000NonoperatingHours: null,
        failureRateOverrideEnabled: false,
        failureRateOverrideFpmh: null,
        notes: '',
      }],
      blockSeq: blockSeq + 1,
    })
    setBlockName('')
  }

  const renameBlock = (id: string) => {
    const blk = blocks.find(b => b.id === id)
    if (!blk) return
    const name = window.prompt('Block name:', blk.name)
    if (name && name.trim()) {
      patchInputs({ blocks: blocks.map(b => b.id === id ? { ...b, name: name.trim() } : b) })
    }
  }

  /** Delete a block; its child parts and child blocks move up to the block's parent. */
  const deleteBlock = (id: string) => {
    const blk = blocks.find(b => b.id === id)
    if (!blk) return
    const parent = blk.parentId ?? null
    patchInputs({
      blocks: blocks
        .filter(b => b.id !== id)
        .map(b => (b.parentId === id ? { ...b, parentId: parent } : b)),
      parts: parts.map(p => ((p.parentId ?? null) === id ? { ...p, parentId: parent } : p)),
      contributionBlockIds: contributionBlockIds.filter(blockId => blockId !== id),
    })
    setSelectedBlockId(current => current === id ? null : current)
  }

  const updateBlockField = (id: string, field: keyof SystemBlock, value: unknown) =>
    patchInputs({
      blocks: blocks.map(block => block.id === id
        ? { ...block, [field]: value } : block),
    })

  /** Blocks in depth-first order with depth, for selects and tree rendering. */
  const orderedBlocks = (() => {
    const out: { block: SystemBlock; depth: number }[] = []
    const walk = (parentId: string | null, depth: number) => {
      for (const b of blocks.filter(b => (b.parentId ?? null) === parentId)) {
        out.push({ block: b, depth })
        walk(b.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  })()

  /** Shared <option> list for parent-block selects, indented by depth. */
  const blockOptions = (
    <>
      <option value="">— (top level)</option>
      {orderedBlocks.map(({ block, depth }) => (
        <option key={block.id} value={block.id}>
          {'  '.repeat(depth)}{block.name}
        </option>
      ))}
    </>
  )

  // Functional parts updater — reads the latest state so the row callbacks below
  // stay referentially stable (they don't close over `parts`), letting the
  // memoized <PartRow> skip unchanged rows on a single-cell edit.
  const patchPartsFn = useCallback(
    (updater: (parts: PredictionPart[]) => PredictionPart[]) => {
      deratingRequestSeq.current += 1
      setDeratingLoading(false)
      setState(s => ({
        ...s,
        parts: updater(s.parts),
        result: null,
        deratingResult: null,
      }))
      setDeratingError(null)
    },
    [setState])

  const removePart = useCallback((idx: number) =>
    patchPartsFn(ps => ps.filter((_, i) => i !== idx)), [patchPartsFn])

  const updatePartQty = useCallback((idx: number, qty: string) => {
    const n = parseInt(qty, 10)
    patchPartsFn(ps => ps.map((p, i) => i === idx
      ? { ...p, quantity: isNaN(n) || n < 1 ? 1 : n } : p))
  }, [patchPartsFn])

  const cyclePartVita = useCallback((idx: number) =>
    patchPartsFn(ps => ps.map((p, i) => i === idx
      ? { ...p, apply_vita: nextVita(p.apply_vita) } : p)), [patchPartsFn])

  // Stable selection callbacks (functional setState → no dep on selectedPartIdx).
  const onSelectPart = useCallback((idx: number) => {
    setActiveParameter(null)
    setSelectedBlockId(null)
    setShowAllDeratingInputs(false)
    setSelectedPartIdx(prev => prev === idx ? null : idx)
  }, [])
  const onRemovePart = useCallback((idx: number) => {
    removePart(idx)
    setActiveParameter(null)
    setSelectedPartIdx(prev => prev == null ? prev : prev === idx ? null : prev > idx ? prev - 1 : prev)
  }, [removePart])

  /** Update a specific field on a part in the parts list (clears results). */
  const updatePartField = (idx: number, field: string, value: unknown) =>
    patchInputs({
      parts: parts.map((p, i) => i === idx ? { ...p, [field]: value } : p),
    })

  /** Update a parameter within a part's params bag (clears results). */
  const updatePartParam = (idx: number, key: string, value: PredictionParamValue) =>
    patchInputs({
      parts: parts.map((p, i) => {
        if (i !== idx) return p
        const nextParams = { ...p.params }
        if (value === '') delete nextParams[key]
        else nextParams[key] = value
        if (p.category === 'parts_count' && key === 'part_type') {
          const entry = partsCountEntry(value)
          if (entry) nextParams.quality = entry.default_quality
        }
        return { ...p, params: nextParams }
      }),
    })

  /** Replace the RADC model input bag so parameters from another model cannot leak through. */
  const setNonoperatingModel = (idx: number, model: string) =>
    patchInputs({
      parts: parts.map((part, i) => i === idx
        ? { ...part, nonoperating_params: model ? { model } : {} }
        : part),
    })

  /** Update a source-specific RADC input (separate from operating handbook inputs). */
  const updateNonoperatingParam = (idx: number, key: string, value: unknown) =>
    patchInputs({
      parts: parts.map((part, i) => {
        if (i !== idx) return part
        const next = { ...(part.nonoperating_params ?? {}) }
        if (value == null || value === '') delete next[key]
        else next[key] = value
        return { ...part, nonoperating_params: next }
      }),
    })

  /** Replace source-specific operational derating inputs when family changes. */
  const setDeratingFamily = (idx: number, family: string) => {
    deratingRequestSeq.current += 1
    setDeratingLoading(false)
    setDeratingError(null)
    setShowAllDeratingInputs(false)
    setState(current => ({
      ...current,
      parts: current.parts.map((part, i) => i === idx
        ? {
            ...part,
            derating_params: family ? { profile: deratingStandard, family } : {},
          }
        : part),
      deratingResult: null,
    }))
  }

  /** Update an operational derating input without contaminating prediction inputs. */
  const updateDeratingParam = (idx: number, key: string, value: unknown) => {
    deratingRequestSeq.current += 1
    setDeratingLoading(false)
    setDeratingError(null)
    setState(current => ({
      ...current,
      parts: current.parts.map((part, i) => {
        if (i !== idx) return part
        const next: Record<string, unknown> = part.derating_params?.profile === deratingStandard
          ? { ...part.derating_params }
          : { profile: deratingStandard }
        if (value == null || value === '') delete next[key]
        else next[key] = value
        return { ...part, derating_params: next }
      }),
      deratingResult: null,
    }))
  }

  const selectedPart = selectedPartIdx != null ? parts[selectedPartIdx] : null
  const selectedBlock = selectedBlockId != null
    ? blocks.find(block => block.id === selectedBlockId) ?? null
    : null
  const selectedBlockResult = selectedBlockId != null
    ? result?.blocks?.find(block => block.id === selectedBlockId) ?? null
    : null
  const selectedResult = selectedPartIdx != null ? result?.results[selectedPartIdx] : null
  const nonoperatingCatalogLoaded = Object.keys(nonoperatingModels).length > 0
  const selectedNonoperatingModel = selectedPart?.nonoperating_params?.model
    ? String(selectedPart.nonoperating_params.model)
    : ''
  const selectedAutomaticRADC = selectedPart
    ? automaticNonoperatingModels[selectedPart.category]
    : undefined
  const selectedRADCDefinition = nonoperatingModels[
    selectedNonoperatingModel || selectedAutomaticRADC?.model || ''
  ]
  const selectedRADCInputKeys = (() => {
    if (!selectedPart) return [] as string[]
    if (!selectedNonoperatingModel) return selectedAutomaticRADC?.input_keys ?? []
    if (!selectedRADCDefinition) return [] as string[]
    const keys = [
      ...selectedRADCDefinition.required_parameters,
      ...Object.keys(selectedRADCDefinition.conditional_parameters ?? {}),
    ]
    if (selectedNonoperatingModel === 'miscellaneous_part') {
      keys.push('fiber_length_km', 'quality')
    }
    return [...new Set(keys)].filter(key =>
      !RADC_CONTEXT_PARAMETERS.has(key) && !key.includes('/'))
  })()
  const selectedDeratingProfile = deratingStandards.find(
    profile => profile.key === deratingStandard,
  )
  const selectedDeratingFamilies = selectedDeratingProfile?.profile_schema?.families ?? []
  const deratingLevelAppliesFor = (profileKey: string) => {
    if (profileKey === 'Custom') return true
    const profile = deratingStandards.find(candidate => candidate.key === profileKey)
    if (profile?.level_mode !== 'manual_three_level') return false
    const allFamiliesAreSaw = profileKey === 'RADC-TR-84-254'
      && parts.length > 0
      && parts.every(part => {
        const explicitFamily = part.derating_params?.profile === profileKey
          ? String(part.derating_params?.family ?? '') : ''
        return resolveAutomaticDeratingInputs(
          profile.profile_schema,
          part,
          explicitFamily || undefined,
        )?.family === 'saw'
      })
    return !allFamiliesAreSaw
  }
  const deratingLevelApplies = deratingLevelAppliesFor(deratingStandard)
  const ownDeratingParams = selectedPart?.derating_params?.profile === deratingStandard
    ? selectedPart.derating_params
    : {}
  const matchingPartDeratingSource = selectedPart && selectedPartIdx != null
    ? parts.find((candidate, candidateIndex) =>
        candidateIndex !== selectedPartIdx
        && candidate.category === selectedPart.category
        && normalizePartNumber(candidate.part_number) !== ''
        && normalizePartNumber(candidate.part_number) === normalizePartNumber(selectedPart.part_number)
        && candidate.derating_params?.profile === deratingStandard
        && (!ownDeratingParams.family || candidate.derating_params?.family === ownDeratingParams.family)
        && Object.keys(candidate.derating_params).some(key => key !== 'profile'))
    : undefined
  const matchingPartDeratingParams = matchingPartDeratingSource?.derating_params ?? {}
  const explicitDeratingParams = {
    ...matchingPartDeratingParams,
    ...ownDeratingParams,
  }
  const explicitDeratingFamilyKey = explicitDeratingParams.family
    ? String(explicitDeratingParams.family)
    : ''
  const automaticDeratingResolution = resolveAutomaticDeratingInputs(
    selectedDeratingProfile?.profile_schema,
    selectedPart,
    explicitDeratingFamilyKey || undefined,
  )
  const selectedDeratingParams = {
    ...(automaticDeratingResolution?.values ?? {}),
    ...explicitDeratingParams,
  }
  const matchingDeratingFamilies = selectedPart
    ? selectedDeratingFamilies.filter(family =>
        family.executable !== false
        && family.category_hints?.includes(selectedPart.category))
    : []
  const suggestedDeratingFamily = !automaticDeratingResolution
    && matchingDeratingFamilies.length === 1
    ? matchingDeratingFamilies[0].key
    : undefined
  const selectedDeratingFamilyKey = explicitDeratingFamilyKey
    || automaticDeratingResolution?.family
    || ''
  const selectedDeratingFamily = selectedDeratingFamilies.find(
    family => family.key === selectedDeratingFamilyKey,
  )
  const inheritedDeratingFields = new Set(
    [
      ...(automaticDeratingResolution?.inheritedFields ?? []),
      ...Object.keys(matchingPartDeratingParams).filter(key =>
        key !== 'profile' && !Object.prototype.hasOwnProperty.call(ownDeratingParams, key)),
    ].filter(key => !Object.prototype.hasOwnProperty.call(ownDeratingParams, key)),
  )
  const defaultDeratingFields = selectedDeratingFamily?.fields.filter(field =>
    !inheritedDeratingFields.has(field.key)
    && (field.required
      || Object.prototype.hasOwnProperty.call(explicitDeratingParams, field.key))) ?? []
  const displayedDeratingFields = showAllDeratingInputs
    ? selectedDeratingFamily?.fields ?? []
    : defaultDeratingFields
  const selectedBlockDescendants = selectedBlockId == null ? new Set<string>() : (() => {
    const descendants = new Set<string>()
    const visit = (parentId: string) => {
      for (const child of blocks.filter(block => block.parentId === parentId)) {
        if (descendants.has(child.id)) continue
        descendants.add(child.id)
        visit(child.id)
      }
    }
    visit(selectedBlockId)
    return descendants
  })()
  const activeImpact = (
    activeParameter != null && activeParameter.partIndex === selectedPartIdx
      ? selectedResult?.parameter_impacts?.[activeParameter.key]
      : undefined
  )
  const directFactorKeys = new Set(activeImpact?.direct_factor_keys ?? [])
  const downstreamFactorKeys = new Set(activeImpact?.downstream_factor_keys ?? [])
  const directStepIndices = new Set(activeImpact?.direct_step_indices ?? [])
  const downstreamStepIndices = new Set(activeImpact?.downstream_step_indices ?? [])
  const activateParameter = (key: string) => {
    if (selectedPartIdx != null) setActiveParameter({ partIndex: selectedPartIdx, key })
  }
  const isParameterActive = (key: string) =>
    activeParameter?.partIndex === selectedPartIdx && activeParameter.key === key
      && selectedResult?.parameter_impacts?.[key] != null
  const parameterContainerClass = (key: string) => isParameterActive(key)
    ? 'rounded-md bg-blue-50/80 ring-1 ring-blue-300 px-1.5 py-1 -mx-1.5 -my-1'
    : ''
  const handleEquationBindingHover = useCallback((binding: EquationSymbolBinding | null) => {
    setHoveredEquationFactorKey(binding?.factor_key ?? null)
  }, [])

  /** Resolve the effective environment for a part: part → block hierarchy → global. */
  const resolveEnvironment = (part: PredictionPart): string | undefined => {
    if (part.environment) return part.environment
    let blockId = part.parentId ?? null
    const seen = new Set<string>()
    while (blockId && !seen.has(blockId)) {
      seen.add(blockId)
      const block = blocks.find(b => b.id === blockId)
      if (!block) break
      if (block.environment) return block.environment
      blockId = block.parentId ?? null
    }
    return undefined // will use global
  }

  const run = async () => {
    const hasBlockOverride = blocks.some(block =>
      block.failureRateOverrideEnabled && block.failureRateOverrideFpmh != null)
    if (parts.length === 0 && !hasBlockOverride) {
      setError('Add at least one part or enable a System Block failure-rate override.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const apiParts = parts.map(({ parentId, ...rest }) => ({
        ...rest,
        // Blank optional controls are an editor state, not a numerical value.
        // Omit them so the model receives None/default rather than float('').
        params: Object.fromEntries(Object.entries(rest.params).filter(([, value]) =>
          !(typeof value === 'string' && value.trim() === ''))),
        environment: rest.environment || undefined,
        parent_id: parentId || undefined,
      }))
      const apiBlocks = blocks.map(block => ({
        id: block.id,
        name: block.name,
        parent_id: block.parentId || undefined,
        quantity: block.quantity ?? 1,
        operating_fraction: block.operatingFraction ?? 1,
        environment: block.environment || undefined,
        nonoperating_environment: block.nonoperatingEnvironment || undefined,
        nonoperating_temperature_c: block.nonoperatingTemperatureC ?? undefined,
        power_cycles_per_1000_nonoperating_hours:
          block.powerCyclesPer1000NonoperatingHours ?? undefined,
        notes: block.notes || undefined,
        failure_rate_override_enabled: block.failureRateOverrideEnabled ?? false,
        failure_rate_override_fpmh: block.failureRateOverrideFpmh ?? undefined,
      }))
      let res: PredictionResponse
      if (standard === 'MIL-HDBK-217F') {
        res = await predictFailureRate({
          environment, vita_global: vitaGlobal, parts: apiParts, blocks: apiBlocks,
        })
      } else {
        res = await predictMultiStandard({
          standard,
          environment,
          vita_global: vitaGlobal,
          parts: apiParts,
          process_grade: processGrade,
          process_score: processScore,
          blocks: apiBlocks,
        })
      }
      patch({ result: res })
      // Auto-run derating analysis after successful prediction
      if (deratingEnabled && parts.length > 0) {
        runDerating()
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running prediction.')
    } finally {
      setLoading(false)
    }
  }

  // --- derating analysis ---
  const runDerating = async (level?: string, std?: string) => {
    if (parts.length === 0) return
    const requestId = ++deratingRequestSeq.current
    const originFolioId = folios.activeId
    setDeratingLoading(true)
    setDeratingError(null)
    try {
      const effectiveStd = std ?? deratingStandard
      const apiParts = parts.map(({ parentId: _parentId, ...rest }, index) => ({
        ...rest,
        derating_params: effectiveDeratingParams(parts, index, effectiveStd),
      }))
      const rules = effectiveStd === 'Custom' && Object.keys(customRules).length > 0 ? customRules : undefined
      const effectiveLevel = deratingLevelAppliesFor(effectiveStd)
        ? (level ?? deratingLevel)
        : null
      const res = await analyzeDerating(apiParts, effectiveLevel, effectiveStd, rules)
      if (requestId === deratingRequestSeq.current
          && activeFolioIdRef.current === originFolioId) {
        setState(current => ({
          ...current,
          deratingResult: res,
        }))
      }
    } catch (cause: unknown) {
      if (requestId === deratingRequestSeq.current
          && activeFolioIdRef.current === originFolioId) {
        const detail = (cause as { response?: { data?: { detail?: unknown } } })
          ?.response?.data?.detail
        setState(current => ({ ...current, deratingResult: null }))
        setDeratingError(typeof detail === 'string'
          ? detail
          : 'Derating analysis failed. Review the selected profile and source inputs.')
      }
    } finally {
      if (requestId === deratingRequestSeq.current
          && activeFolioIdRef.current === originFolioId) setDeratingLoading(false)
    }
  }

  // --- custom derating rules import/export ---
  const customRulesFileRef = useRef<HTMLInputElement>(null)

  const exportCustomRules = () => {
    const payload = { version: 1, type: 'perdura-derating-rules', rules: customRules }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'derating-rules.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importCustomRules = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        // Accept either the wrapped {rules: {...}} payload or a bare rules map.
        const raw = (parsed && typeof parsed === 'object' && 'rules' in parsed)
          ? (parsed as { rules: unknown }).rules
          : parsed
        if (!raw || typeof raw !== 'object') throw new Error('Invalid file format')
        const clean: Record<string, CustomDeratingRule[]> = {}
        for (const [cat, list] of Object.entries(raw as Record<string, unknown>)) {
          if (!Array.isArray(list)) continue
          const rules: CustomDeratingRule[] = []
          for (const r of list as Record<string, unknown>[]) {
            if (!r || typeof r !== 'object' || !r.param) continue
            rules.push({
              param: String(r.param),
              desc: String(r.desc ?? r.param),
              unit: r.unit === '°C' ? '°C' : 'ratio',
              level_I: Number(r.level_I) || 0,
              level_II: Number(r.level_II) || 0,
              level_III: Number(r.level_III) || 0,
              ...(r.rated != null ? { rated: Number(r.rated) } : {}),
            })
          }
          if (rules.length > 0) clean[cat.toLowerCase()] = rules
        }
        if (Object.keys(clean).length === 0) throw new Error('No valid rules found')
        setCustomRules(clean)
        setDeratingStandard('Custom')
        setError(null)
      } catch (e) {
        setError(`Could not import derating rules: ${e instanceof Error ? e.message : 'invalid file'}`)
      }
    }
    reader.readAsText(file)
  }

  // --- mission profile ---
  const addMissionPhase = () => {
    setMissionPhases(prev => [...prev, {
      name: `Phase ${prev.length + 1}`, duration: 1000,
      environment: getEnvironments(standard)[0].code,
      temperature: 40, operating_fraction: 1.0,
      nonoperating_environment: null,
      nonoperating_temperature_c: null,
      power_cycles_per_1000_nonoperating_hours: null,
      description: '',
    }])
  }
  const removeMissionPhase = (idx: number) => {
    setMissionPhases(prev => prev.filter((_, i) => i !== idx))
  }
  const updateMissionPhase = (idx: number, field: string, value: string | number | boolean | null) => {
    setMissionPhases(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))
  }
  const loadPresetProfile = (key: string) => {
    const p = presetProfiles[key]
    if (p) {
      // Preset phases are defined with MIL-HDBK-217F environment codes;
      // map them to the active standard's vocabulary.
      setMissionPhases(p.phases.map(ph => ({
        ...ph,
        environment: mapEnvironment(ph.environment, 'MIL-HDBK-217F', standard),
      })))
      setMissionProfileName(p.name)
    }
  }
  const runMissionProfile = async () => {
    if (parts.length === 0 || missionPhases.length === 0) return
    setLoading(true)
    try {
      const apiParts = parts.map(({ parentId: _parentId, ...rest }) => ({
        ...rest,
        environment: resolveEnvironment({ ...rest, parentId: _parentId }) || undefined,
      }))
      const res = await predictMissionProfile({
        profile_name: missionProfileName,
        phases: missionPhases,
        parts: apiParts,
        standard,
        vita_global: vitaGlobal,
      })
      setMissionResult(res)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const message = typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
          ? detail.message
          : 'Mission profile error.'
      setError(message)
    } finally { setLoading(false) }
  }

  // --- parts list import/export ---

  const exportParts = () => {
    const payload = {
      app: 'reliability-suite',
      version: 1,
      modules: {
        prediction: {
          environment, vitaGlobal, missionHours, failureRateUnit, parts, blocks, blockSeq,
          deratingStandard, deratingLevel, customRules,
        },
      },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'parts_list.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const importParts = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result))
        // Accept module/project exports or a bare prediction slice
        const slice = payload?.modules?.prediction ?? payload
        if (!Array.isArray(slice?.parts)) {
          setError('File does not contain a parts list.')
          return
        }
        setError(null)
        if (!Array.isArray(slice.blocks) || typeof slice.blockSeq !== 'number') {
          setError('Parts list uses an unsupported project format.')
          return
        }
        const nextParts = slice.parts as PredictionPart[]
        const nextBlocks = slice.blocks as SystemBlock[]
        const nextSeq = slice.blockSeq as number
        patchInputs({
          environment: typeof slice.environment === 'string' ? slice.environment : environment,
          vitaGlobal: typeof slice.vitaGlobal === 'boolean' ? slice.vitaGlobal : vitaGlobal,
          missionHours: typeof slice.missionHours === 'string' ? slice.missionHours : missionHours,
          failureRateUnit: ['per_hour', 'fpmh', 'fit'].includes(slice.failureRateUnit)
            ? slice.failureRateUnit as 'per_hour' | 'fpmh' | 'fit' : failureRateUnit,
          parts: nextParts,
          blocks: nextBlocks,
          blockSeq: nextSeq,
          deratingStandard: typeof slice.deratingStandard === 'string'
            ? slice.deratingStandard : deratingStandard,
          deratingLevel: ['I', 'II', 'III'].includes(slice.deratingLevel)
            ? slice.deratingLevel as 'I' | 'II' | 'III' : deratingLevel,
          customRules: slice.customRules && typeof slice.customRules === 'object'
            && !Array.isArray(slice.customRules)
            ? slice.customRules as Record<string, CustomDeratingRule[]> : customRules,
        })
      } catch {
        setError('File is not valid JSON.')
      }
    }
    reader.readAsText(file)
  }

  // Block-based hierarchy: collapse state is keyed by block id
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set())
  const toggleBlock = (id: string) =>
    setCollapsedBlocks(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  type TreeRow =
    | { type: 'block'; block: SystemBlock; depth: number; partIndices: number[] /* all descendant part indices */ }
    | { type: 'part'; index: number; depth: number }

  const flatRows = (() => {
    const rows: TreeRow[] = []
    const blockIds = new Set(blocks.map(b => b.id))
    // Parts pointing at a missing block fall back to root level
    const effParent = (p: PredictionPart): string | null =>
      p.parentId != null && blockIds.has(p.parentId) ? p.parentId : null
    const childBlocks = (parentId: string | null) =>
      blocks.filter(b => (b.parentId ?? null) === parentId)
    const childParts = (parentId: string | null) =>
      parts.reduce<number[]>((acc, p, i) => {
        if (effParent(p) === parentId) acc.push(i)
        return acc
      }, [])
    const descendantParts = (id: string): number[] => {
      const out = [...childParts(id)]
      for (const c of childBlocks(id)) out.push(...descendantParts(c.id))
      return out
    }
    const walk = (parentId: string | null, depth: number) => {
      for (const b of childBlocks(parentId)) {
        rows.push({ type: 'block', block: b, depth, partIndices: descendantParts(b.id) })
        if (!collapsedBlocks.has(b.id)) walk(b.id, depth + 1)
      }
      for (const i of childParts(parentId)) rows.push({ type: 'part', index: i, depth })
    }
    walk(null, 0)
    return rows
  })()

  // Category labels for the current standard — looked up once per render and
  // passed to each memoized <PartRow> as a plain string.
  const catLabels = getCategoryLabels(standard)

  // --- plots ---

  const reliabilityPlot = useMemo(() => {
    const serviceRate = result?.total_failure_rate
    if (serviceRate == null || serviceRate <= 0) return []
    const tMax = Math.max(parseFloat(missionHours) || 8760, 1) * 2
    const n = 200
    const t: number[] = []
    const R: number[] = []
    for (let i = 0; i <= n; i++) {
      const ti = (tMax * i) / n
      t.push(ti)
      R.push(Math.exp(-serviceRate * ti / 1e6))
    }
    const traces: Record<string, unknown>[] = [
      { x: t, y: R, mode: 'lines', name: 'R(t)', line: { color: '#3b82f6', width: 2 } },
    ]
    const tm = parseFloat(missionHours)
    if (!isNaN(tm) && tm > 0) {
      traces.push({
        x: [tm, tm], y: [0, 1], mode: 'lines',
        name: `Mission (${tm.toLocaleString()} h)`,
        line: { color: '#ef4444', width: 1.5, dash: 'dash' },
      })
    }
    return traces
  }, [result, missionHours])

  // Contribution pie chart data. The system view aggregates at the top level;
  // the selected-block view filters to the requested subtrees and shows the
  // immediate contents of each selected root for a useful local breakdown.
  const contributionPie = useMemo(() => {
    if (!result || (result.results.length === 0 && !(result.blocks?.length))) return null
    const blockById = new Map(blocks.map(b => [b.id, b]))
    const blockResultById = new Map((result.blocks ?? []).map(block => [block.id, block]))
    const partLabel = (i: number) => parts[i]?.name
      || `${getCategoryLabels(standard)[parts[i]?.category] ?? parts[i]?.category} ${i + 1}`
    const sliceMap = new Map<string, number>()
    const addSlice = (label: string, value: number | null | undefined) => {
      if (value != null && value > 0) {
        sliceMap.set(label, (sliceMap.get(label) ?? 0) + value)
      }
    }

    if (contributionScope === 'system') {
      result.results.forEach((row, index) => {
        if ((parts[index]?.parentId ?? null) === null) {
          addSlice(partLabel(index), row.system_contribution_failure_rate)
        }
      })
      ;(result.blocks ?? []).filter(block => block.parent_id == null)
        .forEach(block => addSlice(block.name, block.system_contribution_failure_rate))
    } else {
      const selected = new Set(contributionBlockIds)
      // If both an ancestor and a descendant are checked, the ancestor already
      // covers that subtree; retaining only outer roots prevents double-counting.
      const roots = contributionBlockIds.filter(id => {
        let parentId = blockById.get(id)?.parentId ?? null
        const seen = new Set<string>()
        while (parentId && !seen.has(parentId)) {
          if (selected.has(parentId)) return false
          seen.add(parentId)
          parentId = blockById.get(parentId)?.parentId ?? null
        }
        return blockById.has(id)
      })

      roots.forEach(rootId => {
        const root = blockResultById.get(rootId)
        if (!root) return
        const prefix = roots.length > 1 ? `${root.name} / ` : ''
        const systemScale = root.failure_rate != null
          && root.system_expanded_failure_rate != null
          && root.failure_rate > 0
          ? root.system_expanded_failure_rate / root.failure_rate : 1
        if (root.override_applied) {
          addSlice(`${prefix}${root.name} override`, root.system_expanded_failure_rate)
          return
        }
        result.results.forEach((row, index) => {
          if ((parts[index]?.parentId ?? null) === rootId) {
            addSlice(`${prefix}${partLabel(index)}`, (row.line_total_failure_rate ?? 0) * systemScale)
          }
        })
        ;(result.blocks ?? []).filter(block => block.parent_id === rootId)
          .forEach(block => addSlice(
            `${prefix}${block.name}`,
            block.total_failure_rate == null ? null : block.total_failure_rate * systemScale,
          ))
      })
    }
    const labels = [...sliceMap.keys()]
    const values = [...sliceMap.values()]
    return labels.length > 0 ? { labels, values } : null
  }, [result, blocks, parts, standard, contributionScope, contributionBlockIds.join('|')])

  const missionR = useMemo(() => {
    if (result?.total_failure_rate == null) return null
    const tm = parseFloat(missionHours)
    if (isNaN(tm) || tm <= 0) return null
    return Math.exp(-result.total_failure_rate * tm / 1e6)
  }, [result, missionHours])

  const hasContributionResults = !!result
    && (result.results.length > 0 || (result.blocks?.length ?? 0) > 0)

  return (
    <div className="flex flex-col h-full">
      <FolioBar api={folios} />
      <div className="flex flex-1 min-h-0">
      {/* Left panel */}
      <aside className="w-80 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Prediction Standard</label>
            <select value={standard} onChange={e => changeStandard(e.target.value as PredictionStandard)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 font-semibold">
              {(Object.keys(STANDARD_INFO) as PredictionStandard[]).map(s => (
                <option key={s} value={s}>{STANDARD_INFO[s].name}</option>
              ))}
            </select>
            <p className="text-[10px] text-gray-500 mt-1 px-0.5">{STANDARD_INFO[standard].description}</p>
            {standardMethods[standard]?.methodology && (
              <div className="mt-1"><MethodologyNotice disclosure={standardMethods[standard].methodology} compact /></div>
            )}
          </div>
          {standard === 'MIL-HDBK-217F' && (
            <>
              <label className="flex items-center justify-between gap-2 rounded border border-purple-200 bg-purple-50 px-3 py-2 cursor-pointer">
                <span>
                  <span className="text-xs font-semibold text-purple-800 block">ANSI/VITA 51.1 supplement</span>
                  <span className="text-[10px] text-purple-500">Apply the complete A/V51.1-2013 (R2018) rule set</span>
                </span>
                <input type="checkbox" checked={vitaGlobal}
                  onChange={e => patchInputs({ vitaGlobal: e.target.checked })}
                  className="rounded text-purple-600 w-4 h-4" />
              </label>
              <p className="text-[10px] text-gray-400 px-1">
                Checking A/V51.1 asserts known commercial-part pedigree and counterfeit controls. Each part can override the global setting (Global / On / Off).
              </p>
            </>
          )}
          {standard === '217Plus' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Process Grade</label>
              <select value={processGrade} onChange={e => setProcessGrade(parseInt(e.target.value))}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value={1}>Grade 1 — Best practices</option>
                <option value={2}>Grade 2 — Above average</option>
                <option value={3}>Grade 3 — Average</option>
                <option value={4}>Grade 4 — Below average</option>
              </select>
              <p className="text-[10px] text-gray-500 mt-1 px-0.5">
                217Plus process grade factor adjusts failure rates by manufacturing and design maturity.
              </p>
            </div>
          )}
          {standard === 'FIDES' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Process Quality Score (0–100)
              </label>
              <input type="number" min={0} max={100} step={5} value={processScore}
                onChange={e => setProcessScore(parseFloat(e.target.value) || 50)}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              <p className="text-[10px] text-gray-500 mt-1 px-0.5">
                FIDES process assessment: 0 = worst (×7.4 multiplier), 100 = best (×1.0).
              </p>
            </div>
          )}
          {standard !== 'FIDES' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1"
                title="Operating environment stress factor applied globally unless overridden per part/block.">
                Environment
              </label>
              <select value={environment} onChange={e => patchInputs({ environment: e.target.value })}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                {getEnvironments(standard).map(env => <option key={env.code} value={env.code}>{env.label}</option>)}
              </select>
              {standard === 'MIL-HDBK-217F' && ENV_DESCRIPTIONS[environment] && (
                <p className="text-[10px] text-gray-500 mt-1 leading-snug px-0.5">{ENV_DESCRIPTIONS[environment]}</p>
              )}
            </div>
          )}
        </div>

        <hr className="border-gray-200" />

        {/* Mission Profile */}
        <div>
          <button onClick={() => setMissionOpen(!missionOpen)}
            className="flex items-center gap-1.5 w-full text-left text-xs font-semibold text-gray-700 hover:text-gray-900">
            {missionOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <MapIcon size={12} className="text-teal-500" />
            Mission Profile
            {missionPhases.length > 0 && (
              <span className="ml-auto text-[10px] text-teal-600 font-normal">
                {missionPhases.length} phase{missionPhases.length !== 1 ? 's' : ''}
              </span>
            )}
          </button>
          {missionOpen && (
            <div className="mt-2 space-y-2">
              <div className="flex gap-1">
                <select onChange={e => e.target.value && loadPresetProfile(e.target.value)}
                  className="flex-1 text-[10px] border rounded px-1 py-1" defaultValue="">
                  <option value="">Load preset…</option>
                  {Object.entries(presetProfiles).map(([k, v]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
                <button onClick={addMissionPhase}
                  className="px-2 py-1 text-[10px] bg-teal-50 text-teal-700 border border-teal-200 rounded hover:bg-teal-100">
                  <Plus size={10} />
                </button>
              </div>
              {missionPhases.map((ph, i) => (
                <div key={i} className="bg-gray-50 border border-gray-200 rounded p-2 space-y-1">
                  <div className="flex items-center gap-1">
                    <input value={ph.name} onChange={e => updateMissionPhase(i, 'name', e.target.value)}
                      className="flex-1 text-[10px] font-medium bg-transparent border-none outline-none" />
                    <button onClick={() => removeMissionPhase(i)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={10} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <div>
                      <label className="text-[9px] text-gray-400">Duration (h)</label>
                      <input type="number" value={ph.duration} min={0.000001} step={100}
                        onChange={e => updateMissionPhase(i, 'duration', parseFloat(e.target.value) || 0.000001)}
                        className="w-full text-[10px] border rounded px-1 py-0.5" />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-400">Env</label>
                      <select value={ph.environment}
                        onChange={e => updateMissionPhase(i, 'environment', e.target.value)}
                        className="w-full text-[10px] border rounded px-1 py-0.5">
                        {getEnvironments(standard).map(env => <option key={env.code} value={env.code}>{env.code}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-400">Temp (°C)</label>
                      <input type="number" value={ph.temperature} step={5}
                        onChange={e => updateMissionPhase(i, 'temperature', parseFloat(e.target.value) || 40)}
                        className="w-full text-[10px] border rounded px-1 py-0.5" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-400">Operating fraction</label>
                    <input type="number" value={ph.operating_fraction} min={0} max={1} step={0.01}
                      disabled={standard !== 'MIL-HDBK-217F'}
                      onChange={e => updateMissionPhase(i, 'operating_fraction',
                        Math.min(1, Math.max(0, Number(e.target.value))))}
                      className="w-full text-[10px] border rounded px-1 py-0.5 disabled:bg-gray-100" />
                  </div>
                  {standard === 'MIL-HDBK-217F' && ph.operating_fraction < 1 && (
                    <div className="grid grid-cols-3 gap-1 border-t border-cyan-100 pt-1">
                      <div>
                        <label className="text-[9px] text-cyan-700">Nonop env</label>
                        <select value={ph.nonoperating_environment ?? ''}
                          onChange={e => updateMissionPhase(i, 'nonoperating_environment', e.target.value || null)}
                          className="w-full text-[10px] border rounded px-1 py-0.5">
                          <option value="">Select…</option>
                          {nonoperatingEnvironments.map(env => <option key={env.code} value={env.code}>{env.code}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] text-cyan-700">Nonop °C</label>
                        <input type="number" value={ph.nonoperating_temperature_c ?? ''} step={1}
                          onChange={e => updateMissionPhase(i, 'nonoperating_temperature_c',
                            e.target.value === '' ? null : Number(e.target.value))}
                          className="w-full text-[10px] border rounded px-1 py-0.5" />
                      </div>
                      <div>
                        <label className="text-[9px] text-cyan-700">Cycles/1k h</label>
                        <input type="number" value={ph.power_cycles_per_1000_nonoperating_hours ?? ''} min={0} step={0.1}
                          onChange={e => updateMissionPhase(i, 'power_cycles_per_1000_nonoperating_hours',
                            e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
                          className="w-full text-[10px] border rounded px-1 py-0.5" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {missionPhases.length > 0 && (
                <button onClick={runMissionProfile} disabled={loading || parts.length === 0}
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] font-semibold bg-teal-600 text-white rounded hover:bg-teal-700 disabled:opacity-50">
                  <Play size={10} /> Run Mission Profile
                </button>
              )}
              {missionResult && (
                <div className="bg-teal-50 border border-teal-200 rounded p-2 text-[10px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-teal-800">Mission: {missionResult.profile_name}</p>
                    {missionResult.methodology && <MethodologyNotice disclosure={missionResult.methodology} compact />}
                    {missionResult.methodology_supplements?.map(supplement => (
                      <MethodologyNotice key={supplement.standard_id} disclosure={supplement} compact />
                    ))}
                  </div>
                  <p>System λ = {missionResult.system_failure_rate != null
                    ? `${formatFailureRate(missionResult.system_failure_rate, 6)} ${failureRateUnitLabel}`
                    : 'Unavailable'}</p>
                  <p>MTBF = {missionResult.system_mtbf?.toLocaleString() ?? '—'} hrs</p>
                  <p>R(mission) = {missionResult.mission_reliability != null
                    ? missionResult.mission_reliability.toFixed(6)
                    : 'Unavailable'}</p>
                  <p className="text-gray-500 mt-0.5">Duration: {missionResult.total_duration.toLocaleString()} hrs</p>
                  {missionResult.warnings?.map((warning, i) => (
                    <p key={i} className="mt-1 text-amber-800">⚠ {warning}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <hr className="border-gray-200" />

        {/* Derating standard + custom rules */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                <AlertTriangle size={12} className="text-amber-500" />
                Derating analysis
              </p>
              <p className="mt-0.5 text-[9px] text-gray-400">
                {deratingEnabled ? deratingStandard : 'Disabled'}
              </p>
            </div>
            <button type="button" role="switch" aria-checked={deratingEnabled}
              onClick={() => {
                const enabled = !deratingEnabled
                setDeratingEnabled(enabled)
                if (enabled && parts.length > 0) runDerating()
              }}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                deratingEnabled ? 'bg-amber-500' : 'bg-gray-300'
              }`}>
              <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                deratingEnabled ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>
          </div>
          {deratingEnabled && (
            <div className="mt-2 space-y-2">
              <div>
                <label className="block text-[10px] font-medium text-gray-600 mb-1">Derating Standard</label>
                <select
                  value={deratingStandard}
                  onChange={e => { setDeratingStandard(e.target.value); if (parts.length > 0) runDerating(undefined, e.target.value) }}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  {deratingStandards.map(s => (
                    <option key={s.key} value={s.key} disabled={s.available === false}>
                      {s.name}{s.available === false ? ' — unavailable' : ''}
                    </option>
                  ))}
                  <option value="Custom">Custom Rules</option>
                </select>
                {deratingStandard !== 'Custom' && (
                  <div className="text-[10px] mt-1 px-0.5 space-y-1">
                    <p className="text-gray-500">
                      {deratingStandards.find(s => s.key === deratingStandard)?.description}
                    </p>
                    {deratingStandards.find(s => s.key === deratingStandard)?.available === false && (
                      <p className="text-amber-700">
                        {deratingStandards.find(s => s.key === deratingStandard)?.reason}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {deratingLevelApplies && (
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Source-defined level</label>
                  <select
                    value={deratingLevel}
                    onChange={e => { setDeratingLevel(e.target.value); if (parts.length > 0) runDerating(e.target.value) }}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  >
                    <option value="I">Level I — Tightest</option>
                    <option value="II">Level II</option>
                    <option value="III">Level III — Least restrictive</option>
                  </select>
                </div>
              )}
              {deratingStandard === 'Custom' && (
                <button onClick={() => setCustomRulesOpen(o => !o)}
                  className="w-full text-[11px] px-2 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100">
                  {customRulesOpen ? 'Hide' : 'Define'} Custom Rules
                  {Object.keys(customRules).length > 0 && (
                    <span className="ml-1 text-purple-500">({Object.keys(customRules).length} categories)</span>
                  )}
                </button>
              )}
              <p className="text-[10px] text-gray-400 px-0.5">
                Enabled derating runs after each prediction. Exact compatible part inputs are reused automatically.
              </p>
              {deratingError && (
                <p role="alert" className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-700">
                  {deratingError}
                </p>
              )}
            </div>
          )}
        </div>

        <hr className="border-gray-200" />

        {/* Part editor */}
        <div>
          <button onClick={() => setPartEditorOpen(open => !open)}
            className="flex items-center gap-1.5 w-full text-left text-xs font-semibold text-gray-700 hover:text-blue-700">
            {partEditorOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Plus size={12} className="text-blue-500" />
            Add part manually
            {!partEditorOpen && (
              <span className="ml-auto max-w-40 truncate text-[10px] font-normal text-gray-400">
                {getCategoryLabels(standard)[category] ?? category}
              </span>
            )}
          </button>
          {partEditorOpen && <div className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                <select value={category} onChange={e => changeCategory(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  {categoryGroups.map(({ group, categories }) => (
                    <optgroup key={group} label={group}>
                      {categories.map(c => (
                        <option key={c} value={c}>{getCategoryLabels(standard)[c] ?? c}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {standard === 'MIL-HDBK-217F' && (category === 'vhsic_microcircuit' || category === 'detailed_cmos') && (
                  <p className="mt-1 text-[9px] leading-snug text-gray-500">
                    §5.3 is the simplified random-rate method; Appendix B is the detailed time-dependent method. They are grouped here but calculated separately.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
                <input type="number" min={1} step={1} value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Reference designator <span className="text-gray-400">(optional)</span>
                </label>
                <input type="text" value={partName} onChange={e => setPartName(e.target.value)}
                  placeholder="e.g. U1, R10-R29"
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Part number <span className="text-gray-400">(optional)</span>
                </label>
                <input type="text" value={partNumber} onChange={e => setPartNumber(e.target.value)}
                  placeholder="Manufacturer P/N"
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
            </div>
            {standard === 'MIL-HDBK-217F' && VITA_CATEGORIES.has(category) && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">VITA 51.1 for this part</label>
                <select value={editorVita}
                  onChange={e => setEditorVita(e.target.value as typeof editorVita)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option value="inherit">Use global setting</option>
                  <option value="on">Apply VITA 51.1</option>
                  <option value="off">MIL-HDBK-217F only</option>
                </select>
              </div>
            )}
            {standard !== 'FIDES' && !NO_ENV_CATEGORIES.has(category) && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Environment override</label>
                <select value={editorEnv}
                  onChange={e => setEditorEnv(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option value="">Use block/global ({environment})</option>
                  {getEnvironments(standard).map(env => <option key={env.code} value={env.code}>{env.label}</option>)}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1"
                  title="A scale factor applied to this part's failure rate — e.g. a failure-mode ratio when only a fraction of part failures cause the effect of interest. Leave at 1 for none.">
                  Multiplier <span className="text-gray-400">(e.g. mode ratio)</span>
                </label>
                <input type="number" step={0.05} min={0} value={editorMultiplier}
                  onChange={e => setEditorMultiplier(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1"
                  title="The system block this part belongs to. Blocks are nestable containers that give per-block λ subtotals and can carry their own environment override. Selecting a block in the parts list sets this default.">
                  Parent block <span className="text-gray-400">(optional)</span>
                </label>
                <select value={editorParentId}
                  onChange={e => setEditorParentId(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  {blockOptions}
                </select>
              </div>
            </div>
            {(getCategoryFields(standard)[category] ?? []).map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-700 mb-1" title={f.help}>{f.label}</label>
                {f.type === 'select' ? (
                  category === 'parts_count' && f.key === 'part_type' ? (
                    <PartsCountTypePicker value={String(params[f.key])} catalog={partsCountCatalog}
                      onChange={value => setParams(p => {
                        const next = { ...p, [f.key]: value }
                        const entry = partsCountEntry(value)
                        if (entry) next.quality = entry.default_quality
                        return next
                      })} />
                  ) : (
                    <select value={String(params[f.key])}
                      onChange={e => setParams(p => {
                        const next = { ...p, [f.key]: e.target.value }
                        if (category === 'parts_count' && f.key === 'part_type') {
                          const entry = partsCountEntry(e.target.value)
                          if (entry) next.quality = entry.default_quality
                        }
                        return next
                      })}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                      {renderSelectOptions(category, params, f)}
                    </select>
                  )
                ) : f.type === 'text' ? (
                  <input type="text" value={String(params[f.key] ?? '')}
                    onChange={e => setParams(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder} title={f.help}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                ) : (
                  <NumberField value={String(params[f.key])}
                    onChange={v => setParams(p => ({ ...p, [f.key]: v }))}
                    semantic={f.label}
                    step={f.step} min={f.min} max={f.max}
                    placeholder={f.placeholder} title={f.help}
                    className="w-full !py-1.5" />
                )}
              </div>
            ))}
            <button onClick={addPart}
              className="flex items-center justify-center gap-1 border border-blue-600 text-blue-600 hover:bg-blue-50 text-xs font-medium py-1.5 rounded transition-colors">
              <Plus size={12} /> Add to parts list
            </button>
          </div>}
        </div>

        <hr className="border-gray-200" />

        {/* System block editor */}
        <div>
          <button onClick={() => setBlockEditorOpen(open => !open)}
            className="flex items-center gap-1.5 w-full text-left text-xs font-semibold text-gray-700 hover:text-gray-900">
            {blockEditorOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Box size={12} className="text-gray-500" />
            Add system block
          </button>
          {blockEditorOpen && <div className="mt-2 flex flex-col gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
              <input type="text" value={blockName} onChange={e => setBlockName(e.target.value)}
                placeholder="e.g. PSU"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Parent block</label>
              <select value={blockParentId}
                onChange={e => setBlockParentId(e.target.value)}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                {blockOptions}
              </select>
            </div>
            <button onClick={addBlock}
              className="flex items-center justify-center gap-1 border border-gray-400 text-gray-600 hover:bg-gray-50 text-xs font-medium py-1.5 rounded transition-colors">
              <Box size={12} /> Add Block
            </button>
          </div>}
        </div>

      </div>
      <div className="flex-shrink-0 border-t border-gray-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs font-medium text-gray-700">Failure-rate units</span>
          <div className="inline-flex overflow-hidden rounded border border-gray-300" role="group" aria-label="Failure-rate display units">
            {([
              ['per_hour', '/hour'],
              ['fpmh', 'FPMH'],
              ['fit', 'FIT'],
            ] as const).map(([unit, label]) => (
              <button key={unit} type="button" onClick={() => patch({ failureRateUnit: unit })}
                aria-pressed={failureRateUnit === unit}
                className={`px-2 py-1 text-[10px] font-semibold transition-colors ${
                  failureRateUnit === unit
                    ? 'bg-blue-600 text-white'
                    : 'border-l border-gray-200 first:border-l-0 bg-white text-gray-600 hover:bg-gray-50'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex-1 text-xs font-medium text-gray-700"
            title="Operating time used to convert the system failure rate into mission reliability R(t) = exp(−λ·t).">
            Mission time <span className="font-normal text-gray-400">(hours)</span>
          </label>
          <input type="number" min={0} step="any" value={missionHours} onChange={e => patch({ missionHours: e.target.value })}
            className="w-28 text-xs border border-gray-300 rounded px-2 py-1.5 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        {error && <p className="max-h-20 overflow-y-auto text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
        <button onClick={run} disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors">
          <Play size={14} />
          {loading ? 'Computing...' : 'Predict Failure Rate'}
        </button>
      </div>
      </aside>

      {/* Main content + optional detail panel */}
      <div className="flex-1 flex min-w-0">
      <div className={`flex-1 overflow-y-auto p-6 min-w-0 ${selectedPart || selectedBlock ? 'pr-0' : ''}`}>
        {/* Component library palette — drag items into the parts list (#12).
            Only components valid for the active standard are shown, organized
            into logical groups (#4, #5). */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setLibraryOpen(o => !o)}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-blue-700 transition-colors"
              title={libraryOpen ? 'Collapse the component library' : 'Expand the component library'}>
              {libraryOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
              Component Library
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-500">
                {paletteGroups.reduce((count, itemGroup) => count + itemGroup.items.length, 0)} types
              </span>
            </button>
            {!libraryOpen && <span className="text-[10px] text-gray-400">Collapsed to keep the parts list in focus</span>}
          </div>
          {libraryOpen && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-gray-200 bg-white p-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)}
                  placeholder="Search component types…"
                  className="w-full rounded border border-gray-200 py-1.5 pl-7 pr-2 text-xs focus:border-blue-400 focus:outline-none" />
              </div>
              <select value={libraryGroup} onChange={e => setLibraryGroup(e.target.value)}
                className="max-w-48 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none">
                <option value="All">All families</option>
                {paletteGroups.map(({ group }) => <option key={group} value={group}>{group}</option>)}
              </select>
              <span className="hidden text-[10px] text-gray-400 xl:inline">Drag into the parts list or a block</span>
            </div>
            <div className="max-h-64 overflow-y-auto p-3 space-y-3">
              {visiblePaletteGroups.map(({ group, items }) => (
                <div key={group}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{group}</div>
                  <div className="flex flex-wrap gap-2">
                    {items.map(item => {
                      const { Icon } = item
                      return (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={e => onPaletteDragStart(e, item)}
                          onDragEnd={() => setDropTarget(null)}
                          title={`Drag to add a ${item.label}`}
                          className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing select-none rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 shadow-sm hover:border-blue-400 hover:bg-blue-50 transition-colors">
                          <Icon size={14} className={`flex-shrink-0 ${item.color}`} />
                          <span className="whitespace-nowrap">{item.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {visiblePaletteGroups.length === 0 && (
                <p className="py-5 text-center text-xs text-gray-400">No component types match this filter.</p>
              )}
            </div>
          </div>
          )}
        </div>

        {/* Parts list — always visible and prominent */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">
              Parts List <span className="text-gray-400 font-normal">({parts.length} line item{parts.length === 1 ? '' : 's'})</span>
            </h3>
            <div className="flex gap-2">
              <ExampleButton
                hasData={parts.length > 0 || blocks.length > 0}
                onLoad={loadExample}
                className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 border border-gray-200 px-2 py-1 rounded"
              />
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded">
                <Upload size={12} /> Import
              </button>
              <button onClick={exportParts} disabled={parts.length === 0}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded disabled:opacity-40">
                <Download size={12} /> Export
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) importParts(f); e.target.value = '' }} />
            </div>
          </div>

          {parts.length === 0 && blocks.length === 0 ? (
            <div
              onDragOver={e => onDropTargetOver(e, 'root')}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => onPaletteDrop(e, 'root')}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dropTarget === 'root'
                  ? 'border-blue-400 bg-blue-50 text-blue-500'
                  : 'border-gray-200 text-gray-400'
              }`}>
              <p className="text-sm font-medium">No parts yet</p>
              <p className="text-xs mt-1">Browse standard component types, add a line item manually, or import a parts list.</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button onClick={() => setLibraryOpen(true)}
                  className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">
                  Browse Component Library
                </button>
                <button onClick={() => setPartEditorOpen(true)}
                  className="rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  Add manually
                </button>
              </div>
            </div>
          ) : (
            <div
              onDragOver={e => onDropTargetOver(e, 'root')}
              onDragLeave={e => { if (e.currentTarget === e.target) setDropTarget(null) }}
              onDrop={e => onPaletteDrop(e, 'root')}
              className={`overflow-x-auto border rounded-lg transition-colors ${
                dropTarget === 'root' ? 'border-blue-400 ring-1 ring-inset ring-blue-300' : 'border-gray-200'
              }`}>
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Part</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Category</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 w-16">Qty</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 w-14">Mult</th>
                    {standard === 'MIL-HDBK-217F' && <th className="px-3 py-2 text-center font-medium text-gray-600">VITA 51.1</th>}
                    <th className="px-3 py-2 text-center font-medium text-gray-600 w-16">Env</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">λ each ({failureRateUnitLabel})</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">λ total ({failureRateUnitLabel})</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Contribution</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Factors</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {flatRows.map(row => {
                    if (row.type === 'block') {
                      const { block, partIndices } = row
                      const isCollapsed = collapsedBlocks.has(block.id)
                      const blockResult = result?.blocks?.find(item => item.id === block.id)
                      const blockLambda = blockResult?.failure_rate ?? null
                      const blockTotal = blockResult?.total_failure_rate ?? null
                      const blockContrib = blockResult?.contribution ?? null
                      const isActive = editorParentId === block.id
                      const isSelectedBlock = selectedBlockId === block.id
                      const isDropHere = dropTarget === block.id
                      return (
                        <tr key={`b:${block.id}`}
                          onDragOver={e => { e.stopPropagation(); onDropTargetOver(e, block.id) }}
                          onDragLeave={() => { if (dropTarget === block.id) setDropTarget(null) }}
                          onDrop={e => onPaletteDrop(e, block.id)}
                          className={`border-t border-gray-200 cursor-pointer hover:bg-gray-100 group ${
                            isDropHere ? 'bg-blue-100 ring-1 ring-inset ring-blue-400'
                              : isSelectedBlock ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300'
                                : isActive ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-300' : 'bg-gray-50/70'
                          }`}
                          onClick={() => {
                            setSelectedPartIdx(null)
                            setActiveParameter(null)
                            setSelectedBlockId(block.id)
                            setEditorParentId(block.id)
                            setBlockParentId(block.id)
                          }}>
                          <td colSpan={standard === 'MIL-HDBK-217F' ? 5 : 4} className="py-1.5 font-semibold text-gray-700"
                            style={{ paddingLeft: 12 + row.depth * 20 }}>
                            <span className="inline-flex items-center gap-1">
                              <button onClick={event => {
                                event.stopPropagation()
                                toggleBlock(block.id)
                              }} title={isCollapsed ? 'Expand block' : 'Collapse block'}>
                                {isCollapsed
                                  ? <span className="inline-flex"><Folder size={12} className="text-gray-400" /><ChevronRight size={12} className="text-gray-400" /></span>
                                  : <span className="inline-flex"><FolderOpen size={12} className="text-blue-400" /><ChevronDown size={12} className="text-gray-400" /></span>}
                              </button>
                              <span title="Double-click to rename"
                                onDoubleClick={e => { e.stopPropagation(); renameBlock(block.id) }}>
                                {block.name}
                              </span>
                            </span>
                            <span className="text-gray-400 font-normal ml-1">
                              ({partIndices.length} part{partIndices.length === 1 ? '' : 's'})
                            </span>
                            {(block.quantity ?? 1) !== 1 && (
                              <span className="ml-1 rounded bg-slate-200 px-1 text-[9px] text-slate-600">×{block.quantity}</span>
                            )}
                            {standard === 'MIL-HDBK-217F' && (block.operatingFraction ?? 1) !== 1 && (
                              <span className="ml-1 rounded bg-cyan-100 px-1 text-[9px] text-cyan-700">Op={Math.round((block.operatingFraction ?? 1) * 100)}%</span>
                            )}
                            {block.failureRateOverrideEnabled && (
                              <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] text-amber-700">override</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                            {standard === 'FIDES' ? (
                              <span className="text-[10px] text-gray-400" title="Environment-code duty weighting is not applicable to FIDES">N/A</span>
                            ) : (
                              <select
                                value={block.environment || ''}
                                onChange={e => {
                                  const env = e.target.value || null
                                  patchInputs({ blocks: blocks.map(b => b.id === block.id ? { ...b, environment: env } : b) })
                                }}
                                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                                title="Block environment override"
                              >
                                <option value="">Env: Global ({environment})</option>
                                {getEnvironments(standard).map(env => <option key={env.code} value={env.code}>{env.code}</option>)}
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">
                            {blockLambda != null ? formatFailureRate(blockLambda) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">
                            {blockTotal != null ? formatFailureRate(blockTotal) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">
                            {blockContrib != null ? `${(blockContrib * 100).toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-[10px] text-gray-400">
                            {blockResult?.override_applied
                              ? `Calculated ${blockResult.rolled_up_failure_rate != null
                                ? formatFailureRate(blockResult.rolled_up_failure_rate)
                                : 'unavailable'}`
                              : blockResult && blockResult.effective_operating_fraction < 1
                                ? `Service exposure · Op ${Math.round(blockResult.effective_operating_fraction * 100)}%`
                                : '—'}
                          </td>
                          <td className="px-1 py-1.5 text-center">
                            <button onClick={e => { e.stopPropagation(); deleteBlock(block.id) }}
                              title="Delete block (contents move up a level)"
                              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      )
                    }
                    const i = row.index
                    const p = parts[i]
                    return (
                      <PartRow
                        key={`p${i}`}
                        part={p}
                        index={i}
                        depth={row.depth}
                        resultRow={result?.results[i]}
                        categoryLabel={catLabels[p.category] ?? p.category}
                        inheritedEnv={resolveEnvironment(p) || environment}
                        vitaGlobal={vitaGlobal}
                        showVita={standard === 'MIL-HDBK-217F'}
                        failureRateUnit={failureRateUnit}
                        selected={selectedPartIdx === i}
                        onSelect={onSelectPart}
                        onQty={updatePartQty}
                        onCycleVita={cyclePartVita}
                        onRemove={onRemovePart}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {result ? (
          <div ref={resultsRef}>
            <div className="flex justify-end mb-3">
              <ExportResultsButton getElement={() => resultsRef.current} baseName="prediction" />
            </div>
            {result.methodology && <MethodologyNotice disclosure={result.methodology} />}
            {result.methodology_supplements?.map(supplement => (
              <MethodologyNotice key={supplement.standard_id} disclosure={supplement} />
            ))}
            {result.warnings?.map((warning, i) => (
              <div key={i} className="mb-4 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-amber-600" />
                <p>{warning}</p>
              </div>
            ))}
            <p className="mb-4 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
              Prediction context: this is a model-based planning estimate for relative design comparison. It is not an observed or calibrated field failure rate unless supported by representative test or field data.
            </p>
            {/* Incompatible-parts notice — computed what it could, flagged the rest (#3) */}
            {result.incompatible && result.incompatible.length > 0 && (
              <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 text-xs rounded px-3 py-2">
                <AlertTriangle size={15} className="flex-shrink-0 text-red-500 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold">
                    {result.incompatible.length} part{result.incompatible.length === 1 ? '' : 's'} could not be computed under {STANDARD_INFO[standard].name} and {result.incompatible.length === 1 ? 'was' : 'were'} excluded from the totals.
                  </p>
                  <p className="mt-0.5 text-red-700">
                    Highlighted in red below: {result.incompatible.map(p => p.name).join(', ')}. Switch standards or remove these parts to include them.
                  </p>
                </div>
              </div>
            )}
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="rounded-lg border bg-blue-50 border-blue-200 p-3">
                <p className="text-xs text-gray-500">System failure rate</p>
                <p className="text-lg font-semibold text-blue-700">
                  {result.total_failure_rate != null
                    ? <>{formatFailureRate(result.total_failure_rate, 4)} <span className="text-xs font-normal">{failureRateUnitLabel}</span></>
                    : <span className="text-sm text-amber-700">Unavailable</span>}
                </p>
              </div>
              <div className="rounded-lg border bg-white border-gray-200 p-3">
                <p className="text-xs text-gray-500">MTBF</p>
                <p className="text-lg font-semibold text-gray-900">
                  {result.mtbf_hours != null ? `${result.mtbf_hours.toLocaleString()} h` : '∞'}
                </p>
              </div>
              {missionR != null && (
                <div className="rounded-lg border bg-white border-gray-200 p-3">
                  <p className="text-xs text-gray-500">R(mission)</p>
                  <p className="text-lg font-semibold text-gray-900">{missionR.toFixed(4)}</p>
                </div>
              )}
              <div className="rounded-lg border bg-white border-gray-200 p-3">
                <p className="text-xs text-gray-500">Method / environment</p>
                <p className="text-sm font-semibold text-gray-900">
                  {STANDARD_INFO[standard].name}{standard === 'MIL-HDBK-217F' && result.vita_global ? ' + VITA 51.1' : ''}
                  <br />{result.environment}
                </p>
              </div>
            </div>

            {/* Derating Analysis summary for all parts */}
            {deratingEnabled && deratingResult && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-500" />
                    Derating Analysis
                    {deratingResult.methodology && <MethodologyNotice disclosure={deratingResult.methodology} compact />}
                    {deratingLoading && <span className="text-xs font-normal text-gray-400 ml-2">updating...</span>}
                  </h3>
                  <div className="flex items-center gap-2">
                    <select
                      value={deratingStandard}
                      onChange={e => { setDeratingStandard(e.target.value); runDerating(undefined, e.target.value); }}
                      className="text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-white text-gray-700"
                    >
                      {deratingStandards.map(s => (
                        <option key={s.key} value={s.key} disabled={s.available === false}>
                          {s.name}{s.available === false ? ' — unavailable' : ''}
                        </option>
                      ))}
                      <option value="Custom">Custom Rules</option>
                    </select>
                    {deratingStandard === 'Custom' && (
                      <button onClick={() => setCustomRulesOpen(o => !o)}
                        className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100">
                        Edit Rules
                      </button>
                    )}
                    {deratingLevelApplies && (
                      <select
                        value={deratingLevel}
                        onChange={e => { setDeratingLevel(e.target.value); runDerating(e.target.value); }}
                        className="text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-white text-gray-700"
                      >
                        <option value="I">Level I</option>
                        <option value="II">Level II</option>
                        <option value="III">Level III</option>
                      </select>
                    )}
                    <div className="flex gap-1.5">
                      {deratingResult.summary.ok > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                          {deratingResult.summary.ok} OK
                        </span>
                      )}
                      {deratingResult.summary.not_evaluated > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                          {deratingResult.summary.not_evaluated} Not evaluated
                        </span>
                      )}
                      {deratingResult.summary.exceeds > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                          {deratingResult.summary.exceeds} Exceeds
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Part</th>
                        <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Category</th>
                        <th className="px-3 py-1.5 text-center text-gray-600 font-semibold">Status</th>
                        <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Parameters</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deratingResult.results.map((dr, idx) => (
                        <tr
                          key={idx}
                          onClick={() => { setActiveParameter(null); setSelectedPartIdx(idx) }}
                          className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                            selectedPartIdx === idx ? 'bg-blue-50' : ''
                          }`}
                        >
                          <td className="px-3 py-1.5 text-gray-900">{dr.name}</td>
                          <td className="px-3 py-1.5 text-gray-500">{dr.category}</td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              dr.overall_status === 'ok' ? 'bg-green-100 text-green-700' :
                              dr.overall_status === 'exceeds' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {dr.overall_status === 'ok' ? 'OK' : dr.overall_status === 'exceeds' ? 'EXCEEDS' : 'NOT EVALUATED'}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-gray-600">
                            {dr.derating.length === 0 ? (
                              <span className="text-gray-500 italic" title={dr.message ?? undefined}>Not evaluated</span>
                            ) : (
                              <span className="flex flex-wrap gap-1">
                                {dr.derating.map((d, di) => (
                                  <span key={di} className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded ${
                                    d.status === 'ok' ? 'bg-green-50 text-green-700' :
                                    d.status === 'exceeds' ? 'bg-red-50 text-red-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                      d.status === 'ok' ? 'bg-green-500' :
                                      d.status === 'exceeds' ? 'bg-red-500' : 'bg-gray-400'
                                    }`} />
                                    {d.parameter}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Charts: Reliability curve + Contribution pie */}
            <div className={`grid gap-4 ${reliabilityPlot.length > 0 && hasContributionResults ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
            {reliabilityPlot.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">System Reliability vs Time</h3>
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 320 }}>
                  <Plot
                    data={reliabilityPlot as Plotly.Data[]}
                    layout={{
                      xaxis: { title: { text: 'Time (hours)' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'Reliability R(t)' }, range: [0, 1.02], gridcolor: '#e5e7eb' },
                      margin: { t: 20, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      legend: { x: 0.7, y: 0.95, font: { size: 10 } },
                      showlegend: true,
                    } as any}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              </div>
            )}
            {hasContributionResults && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">Failure Rate Contribution</h3>
                  <select
                    value={contributionScope}
                    onChange={e => patch({ contributionScope: e.target.value as 'system' | 'blocks' })}
                    className="text-[11px] border border-gray-300 rounded px-2 py-1 bg-white text-gray-700"
                    title="Choose whether the contribution chart covers the entire system or selected system blocks"
                  >
                    <option value="system">Entire system</option>
                    <option value="blocks" disabled={blocks.length === 0}>Selected block(s)</option>
                  </select>
                </div>
                {contributionScope === 'blocks' && (
                  <div className="mb-2 max-h-24 overflow-y-auto rounded border border-gray-200 bg-gray-50 px-2 py-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {orderedBlocks.map(({ block, depth }) => (
                      <label key={block.id} className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer"
                        title={`${'Nested under '.repeat(Math.min(depth, 1))}${block.name}`}>
                        <input
                          type="checkbox"
                          checked={contributionBlockIds.includes(block.id)}
                          onChange={() => patch({
                            contributionBlockIds: contributionBlockIds.includes(block.id)
                              ? contributionBlockIds.filter(id => id !== block.id)
                              : [...contributionBlockIds, block.id],
                          })}
                          className="rounded text-blue-600"
                        />
                        <span>{depth > 0 ? `${'· '.repeat(depth)}${block.name}` : block.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 320 }}>
                  {contributionPie ? <Plot
                    data={[{
                      labels: contributionPie.labels,
                      values: contributionPie.values.map(scaleFailureRate),
                      type: 'pie',
                      textinfo: 'label+percent',
                      textposition: 'inside',
                      hovertemplate: `%{label}<br>%{value:${failureRateUnit === 'per_hour' ? '.4e' : '.5f'}} ${failureRateUnitLabel}<br>%{percent}<extra></extra>`,
                      marker: {
                        colors: contributionPie.labels.map((_, i) => {
                          const palette = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#e11d48']
                          return palette[i % palette.length]
                        }),
                      },
                    }] as Plotly.Data[]}
                    layout={{
                      title: {
                        text: contributionScope === 'system'
                          ? 'System Failure Rate Contribution'
                          : 'Selected Block Failure Rate Contribution',
                        font: { size: 12 },
                      },
                      margin: { t: 40, r: 20, b: 20, l: 20 },
                      paper_bgcolor: 'white',
                      showlegend: contributionPie.labels.length <= 12,
                      legend: { font: { size: 9 }, orientation: 'v', x: 1.02, y: 1 },
                    } as any}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  /> : (
                    <div className="h-full flex items-center justify-center px-6 text-center text-xs text-gray-400">
                      Select at least one system block containing parts to plot its failure-rate contribution.
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>
          </div>
        ) : (
          parts.length > 0 && (
            <p className="text-xs text-gray-400">
              Click <span className="font-medium">Predict Failure Rate</span> to compute λ for each part.
            </p>
          )
        )}

        <p className="text-xs text-gray-400 mt-4">
          Prediction per {STANDARD_INFO[standard].name}.
          {standard === 'MIL-HDBK-217F' && ' The ANSI/VITA 51.1 supplement applies its R2018 COTS defaults, mappings, extensions, manufacturer-data conversions, and alternate PTH method when checked.'}
          {' '}Verify against the licensed standard for formal deliverables.
        </p>
      </div>

      {/* System Block detail / edit panel */}
      {selectedBlock && (
        <div className="w-96 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
            <h3 className="flex items-center gap-1 text-sm font-semibold text-gray-800">
              <FolderOpen size={14} className="text-indigo-500" />
              {selectedBlock.name}
            </h3>
            <button onClick={() => setSelectedBlockId(null)}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <div>
              <label className="mb-0.5 block text-xs font-medium text-gray-500">Block name</label>
              <input value={selectedBlock.name}
                onChange={event => updateBlockField(selectedBlock.id, 'name', event.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-xs font-medium text-gray-500">Parent block</label>
                <select value={selectedBlock.parentId ?? ''}
                  onChange={event => updateBlockField(selectedBlock.id, 'parentId', event.target.value || null)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400">
                  <option value="">— (top level)</option>
                  {orderedBlocks.filter(({ block }) => (
                    block.id !== selectedBlock.id && !selectedBlockDescendants.has(block.id)
                  ))
                    .map(({ block, depth }) => (
                      <option key={block.id} value={block.id}>{'  '.repeat(depth)}{block.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-gray-500">Quantity</label>
                <input type="number" min={1} step={1} value={selectedBlock.quantity ?? 1}
                  onChange={event => updateBlockField(
                    selectedBlock.id, 'quantity', Math.max(1, parseInt(event.target.value, 10) || 1))}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" />
              </div>
            </div>

            <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 p-3">
              <p className="text-xs font-semibold text-cyan-900">Steady-state exposure</p>
              {standard !== 'MIL-HDBK-217F' ? (
                <p className="mt-1 text-[10px] text-cyan-700">
                  RADC-TR-85-91 nonoperating exposure is available only with MIL-HDBK-217F. This standard retains its own exposure model.
                </p>
              ) : (
                <>
                  <div className="mt-2">
                    <label className="mb-0.5 block text-[10px] font-medium text-cyan-800">Operating fraction</label>
                    <input type="number" min={0} max={1} step={0.01} value={selectedBlock.operatingFraction ?? 1}
                      onChange={event => updateBlockField(
                        selectedBlock.id, 'operatingFraction', Math.min(1, Math.max(0, Number(event.target.value))))}
                      className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400" />
                    <p className="mt-1 text-[9px] text-cyan-700">Fraction of calendar time operating. The remainder uses the separate RADC nonoperating model.</p>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium text-cyan-800">Operating environment</label>
                      <select value={selectedBlock.environment || ''}
                        onChange={event => updateBlockField(selectedBlock.id, 'environment', event.target.value || null)}
                        className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400">
                        <option value="">Inherit ({environment})</option>
                        {getEnvironments(standard).map(env => <option key={env.code} value={env.code}>{env.code}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium text-cyan-800">Nonoperating environment</label>
                      <select value={selectedBlock.nonoperatingEnvironment || ''}
                        onChange={event => updateBlockField(selectedBlock.id, 'nonoperatingEnvironment', event.target.value || null)}
                        className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400">
                        <option value="">Inherit from parent / select…</option>
                        {nonoperatingEnvironments.map(env => <option key={env.code} value={env.code}>{env.code} — {env.description}</option>)}
                      </select>
                    </div>
                  </div>
                  {(selectedBlock.operatingFraction ?? 1) < 1 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-0.5 block text-[10px] font-medium text-cyan-800">Nonoperating temperature (°C)</label>
                        <input type="number" step={1} value={selectedBlock.nonoperatingTemperatureC ?? ''}
                          onChange={event => updateBlockField(
                            selectedBlock.id, 'nonoperatingTemperatureC',
                            event.target.value === '' ? null : Number(event.target.value))}
                          className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400" />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[10px] font-medium text-cyan-800">Power cycles / 1,000 nonop h</label>
                        <input type="number" min={0} step={0.1} value={selectedBlock.powerCyclesPer1000NonoperatingHours ?? ''}
                          onChange={event => updateBlockField(
                            selectedBlock.id, 'powerCyclesPer1000NonoperatingHours',
                            event.target.value === '' ? null : Math.max(0, Number(event.target.value)))}
                          className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400" />
                      </div>
                    </div>
                  )}
                </>
              )}
              {selectedBlockResult && standard === 'MIL-HDBK-217F' && (
                <p className="mt-2 text-[10px] text-cyan-800">
                  Effective operating fraction: {(selectedBlockResult.effective_operating_fraction * 100).toFixed(1)}%
                  {' '}· operating {selectedBlockResult.operating_environment}
                  {selectedBlockResult.nonoperating_environment
                    ? ` / nonoperating ${selectedBlockResult.nonoperating_environment}` : ''}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-amber-900">Block failure-rate override</p>
                  <p className="text-[10px] text-amber-700">Final FPMH per block instance; block quantity applies afterward.</p>
                </div>
                <button type="button" role="switch"
                  aria-checked={selectedBlock.failureRateOverrideEnabled ?? false}
                  onClick={() => updateBlockField(
                    selectedBlock.id,
                    'failureRateOverrideEnabled',
                    !(selectedBlock.failureRateOverrideEnabled ?? false),
                  )}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    selectedBlock.failureRateOverrideEnabled ? 'bg-amber-500' : 'bg-gray-300'
                  }`}>
                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    selectedBlock.failureRateOverrideEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>
              <input type="number" min={0} step="0.000001"
                disabled={!selectedBlock.failureRateOverrideEnabled}
                value={selectedBlock.failureRateOverrideFpmh ?? ''}
                onChange={event => updateBlockField(
                  selectedBlock.id,
                  'failureRateOverrideFpmh',
                  event.target.value === '' ? null : Math.max(0, Number(event.target.value)),
                )}
                placeholder="Override FPMH"
                className="mt-2 w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:bg-gray-100 disabled:text-gray-400" />
              {selectedBlockResult && (
                <p className="mt-1 text-[10px] text-gray-500">
                  Handbook subtotal <span className="font-mono">{formatFailureRate(selectedBlockResult.handbook_subtotal_failure_rate, 8)}</span>
                  {' '}· Service roll-up <span className="font-mono">{selectedBlockResult.rolled_up_failure_rate != null
                    ? formatFailureRate(selectedBlockResult.rolled_up_failure_rate, 8) : 'unavailable'}</span>
                  {selectedBlockResult.override_applied && selectedBlockResult.failure_rate != null && (
                    <> · Effective <span className="font-mono font-semibold text-amber-700">{formatFailureRate(selectedBlockResult.failure_rate, 8)}</span></>
                  )}
                  {' '}{failureRateUnitLabel}
                </p>
              )}
            </div>

            <div>
              <label className="mb-0.5 block text-xs font-medium text-gray-500">Notes</label>
              <textarea value={selectedBlock.notes ?? ''} rows={4}
                onChange={event => updateBlockField(selectedBlock.id, 'notes', event.target.value)}
                placeholder="Block assumptions, provenance, or override justification…"
                className="w-full resize-y rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
          </div>
        </div>
      )}

      {/* Part detail / edit panel */}
      {selectedPart && selectedPartIdx != null && (
        <div className="w-96 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1">
              <ChevronRight size={14} className="text-gray-400" />
              {selectedPart.name || `${getCategoryLabels(standard)[selectedPart.category] ?? selectedPart.category} ${selectedPartIdx + 1}`}
            </h3>
            <button onClick={() => { setActiveParameter(null); setSelectedPartIdx(null) }}
              className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100">
              <X size={14} />
            </button>
          </div>

          <div className="p-4 flex flex-col gap-3">
            <section className="order-1 space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <h4 className="text-xs font-semibold text-gray-800">Component Details</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Category</label>
                  <p className="truncate text-xs font-semibold text-gray-800" title={getCategoryLabels(standard)[selectedPart.category] ?? selectedPart.category}>
                    {getCategoryLabels(standard)[selectedPart.category] ?? selectedPart.category}
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Reference designator</label>
                  <input type="text" value={selectedPart.name ?? ''}
                    onFocus={() => setActiveParameter(null)}
                    onChange={e => updatePartField(selectedPartIdx, 'name', e.target.value || undefined)}
                    placeholder="e.g. U1, R10"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Part number</label>
                <input type="text" value={selectedPart.part_number ?? ''}
                  onFocus={() => setActiveParameter(null)}
                  onChange={e => updatePartField(selectedPartIdx, 'part_number', e.target.value || undefined)}
                  placeholder="Manufacturer or supplier P/N"
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div className="grid grid-cols-3 gap-2" onFocusCapture={() => setActiveParameter(null)}>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Quantity</label>
                  <input type="number" min={1} step={1} value={selectedPart.quantity}
                    onChange={e => { const n = parseInt(e.target.value, 10); updatePartField(selectedPartIdx, 'quantity', isNaN(n) || n < 1 ? 1 : n) }}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Multiplier</label>
                  <input type="number" step={0.05} min={0} value={Number(selectedPart.params.multiplier ?? 1)}
                    onChange={e => { const n = parseFloat(e.target.value); updatePartParam(selectedPartIdx, 'multiplier', isNaN(n) || n <= 0 ? 1 : n) }}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Parent block</label>
                  <select value={selectedPart.parentId ?? ''}
                    onChange={e => updatePartField(selectedPartIdx, 'parentId', e.target.value || null)}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                    {blockOptions}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50/70 p-2">
                <button type="button" role="switch"
                  aria-label="Failure-rate override"
                  aria-checked={selectedPart.failure_rate_override_enabled ?? false}
                  onClick={() => updatePartField(
                    selectedPartIdx,
                    'failure_rate_override_enabled',
                    !(selectedPart.failure_rate_override_enabled ?? false),
                  )}
                  className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                    selectedPart.failure_rate_override_enabled ? 'bg-amber-500' : 'bg-gray-300'
                  }`}>
                  <span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                    selectedPart.failure_rate_override_enabled ? 'translate-x-3' : 'translate-x-0'
                  }`} />
                </button>
                <label className="shrink-0 text-[10px] font-semibold text-amber-900" title="Overrides the final per-piece output while retaining the handbook-calculated value.">
                  Rate override
                </label>
                <input type="number" min={0} step="0.000001"
                  disabled={!selectedPart.failure_rate_override_enabled}
                  value={selectedPart.failure_rate_override_fpmh ?? ''}
                  onChange={event => updatePartField(
                    selectedPartIdx,
                    'failure_rate_override_fpmh',
                    event.target.value === '' ? null : Math.max(0, Number(event.target.value)),
                  )}
                  placeholder="FPMH each"
                  className="min-w-0 flex-1 rounded border border-amber-200 bg-white px-2 py-1 text-xs font-mono disabled:bg-gray-100 disabled:text-gray-400" />
                {selectedResult?.calculated_failure_rate != null && (
                  <span className="shrink-0 text-[9px] text-gray-500" title={`Calculated: ${formatFailureRate(selectedResult.calculated_failure_rate, 8)} ${failureRateUnitLabel}`}>
                    Calc. {formatFailureRate(selectedResult.calculated_failure_rate, 4)}
                  </span>
                )}
              </div>
              <div>
                <label className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-gray-500">
                  <StickyNote size={10} className="text-amber-400" /> Notes
                </label>
                <textarea rows={2} value={selectedPart.notes ?? ''}
                  onFocus={() => setActiveParameter(null)}
                  onChange={e => updatePartField(selectedPartIdx, 'notes', e.target.value || undefined)}
                  placeholder="Part number, supplier, rationale…"
                  className="w-full resize-none rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
            </section>

            {/* Operational derating inputs are source-specific and independent of prediction inputs. */}
            {deratingEnabled && selectedDeratingProfile?.available !== false && selectedDeratingFamilies.length > 0 && (
              <section className="order-[90] rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-1 text-xs font-semibold text-amber-950">
                    <AlertTriangle size={11} className="text-amber-500" /> Derating
                  </h4>
                  <button onClick={() => runDerating()} disabled={deratingLoading}
                    className="rounded border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                    {deratingLoading ? 'Analyzing…' : 'Analyze'}
                  </button>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer select-none text-[10px] font-semibold text-amber-900">
                    {selectedDeratingProfile?.name} inputs
                  </summary>
                  <div className="mt-3 space-y-2">
                  <p className="text-[10px] leading-relaxed text-amber-800">
                    Exact component and value matches are reused from the part above. Only source requirements that
                    Perdura cannot derive safely need another entry.
                  </p>
                  {matchingPartDeratingSource && (
                    <p className="rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-[9px] text-blue-800">
                      Inheriting derating inputs from identical part{' '}
                      <strong>{matchingPartDeratingSource.name || matchingPartDeratingSource.part_number}</strong>
                      {' '}({matchingPartDeratingSource.part_number}). Local entries override shared values.
                    </p>
                  )}
                  <div>
                    <label className="block text-[10px] font-medium text-amber-900">Source family</label>
                    <select value={explicitDeratingFamilyKey}
                      onChange={event => setDeratingFamily(selectedPartIdx, event.target.value)}
                      className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-xs">
                      <option value="">
                        {automaticDeratingResolution?.familyAutomaticallyMatched
                          ? `Automatic — ${selectedDeratingFamily?.label ?? automaticDeratingResolution.family}`
                          : 'Automatic exact match'}
                      </option>
                      {selectedDeratingFamilies.map(family => (
                        <option key={family.key} value={family.key} disabled={family.executable === false}>
                          {family.label}{family.executable === false ? ' — no numerical rule' : ''}
                        </option>
                      ))}
                    </select>
                    {!explicitDeratingFamilyKey && suggestedDeratingFamily && (
                      <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-amber-700">
                        <span>Suggested from the prediction category: {selectedDeratingFamilies.find(
                          family => family.key === suggestedDeratingFamily,
                        )?.label ?? suggestedDeratingFamily}.</span>
                        <button type="button"
                          onClick={() => setDeratingFamily(selectedPartIdx, suggestedDeratingFamily)}
                          className="shrink-0 rounded border border-amber-300 bg-white px-1.5 py-0.5 font-semibold hover:bg-amber-100">
                          Use suggestion
                        </button>
                      </div>
                    )}
                    {!selectedDeratingFamilyKey && matchingDeratingFamilies.length > 1 && (
                      <p className="mt-1 text-[9px] leading-relaxed text-amber-700">
                        {matchingDeratingFamilies.length} source models match this prediction category.
                        Select the exact technology because the existing part fields do not distinguish them.
                      </p>
                    )}
                  </div>
                  {automaticDeratingResolution?.familyAutomaticallyMatched && (
                    <div className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[9px] text-emerald-800">
                      <span>
                        Automatically matched <strong>{selectedDeratingFamily?.label}</strong>
                        {inheritedDeratingFields.size > 0
                          ? ` and reused ${inheritedDeratingFields.size} existing value${inheritedDeratingFields.size === 1 ? '' : 's'}.`
                          : '.'}
                      </span>
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 font-semibold">Exact match</span>
                    </div>
                  )}
                  {selectedDeratingFamily?.reason && (
                    <p className="rounded border border-amber-200 bg-white/70 px-2 py-1.5 text-[10px] text-amber-800">
                      {selectedDeratingFamily.reason}
                    </p>
                  )}
                  {selectedDeratingFamily && (selectedDeratingFamily.guidance?.length ?? 0) > 0 && (
                    <details className="rounded border border-amber-200 bg-white/70 px-2 py-1.5 text-[9px] leading-relaxed text-amber-800">
                      <summary className="cursor-pointer font-semibold">Source guidance</summary>
                      <div className="mt-1.5">
                        {(selectedDeratingFamily.guidance ?? []).map(item => (
                          <p key={item} className="mb-1 last:mb-0">{item}</p>
                        ))}
                      </div>
                    </details>
                  )}
                  {selectedDeratingFamily && selectedDeratingFamily.fields.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[9px] text-amber-800">
                          {showAllDeratingInputs
                            ? `All ${selectedDeratingFamily.fields.length} source inputs`
                            : `${displayedDeratingFields.length} base input${displayedDeratingFields.length === 1 ? '' : 's'} still require attention`}
                        </p>
                        <button type="button"
                          onClick={() => setShowAllDeratingInputs(value => !value)}
                          className="shrink-0 rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 hover:bg-amber-100">
                          {showAllDeratingInputs ? 'Show required only' : 'Show all / override'}
                        </button>
                      </div>
                      {displayedDeratingFields.length === 0 && (
                        <p className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[9px] text-emerald-800">
                          No additional base inputs are required. Conditional and optional source inputs remain
                          available under “Show all / override.”
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                      {displayedDeratingFields.map(field => {
                        const rawValue = selectedDeratingParams[field.key]
                        const effectiveValue = rawValue ?? field.default
                        const inherited = inheritedDeratingFields.has(field.key)
                        const inheritedFromMatchingPart = inherited
                          && Object.prototype.hasOwnProperty.call(matchingPartDeratingParams, field.key)
                          && !Object.prototype.hasOwnProperty.call(ownDeratingParams, field.key)
                        const label = `${field.label}${field.required ? ' *' : field.required_when ? ' †' : ''}${field.unit ? ` (${field.unit})` : ''}`
                        const tooltip = [
                          field.help,
                          field.required_when ? `Required when: ${field.required_when}` : undefined,
                        ].filter(Boolean).join('\n')
                        return (
                          <div key={field.key} className={field.type === 'text' ? 'col-span-2' : ''}>
                            <label className="flex items-center gap-1 text-[10px] font-medium text-amber-900" title={tooltip || undefined}>
                              <span>{label}</span>
                              {tooltip && (
                                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-amber-300 text-[8px] font-bold text-amber-700" aria-label={tooltip}>
                                  ?
                                </span>
                              )}
                              {inherited && (
                                <span className="rounded bg-emerald-100 px-1 py-0.5 text-[8px] font-semibold text-emerald-700">
                                  {inheritedFromMatchingPart ? 'Same P/N' : 'From part'}
                                </span>
                              )}
                            </label>
                            {field.type === 'select' ? (
                              <select value={effectiveValue == null ? '' : String(effectiveValue)}
                                onChange={event => updateDeratingParam(selectedPartIdx, field.key, event.target.value)}
                                className={`w-full rounded border px-2 py-1.5 text-xs ${inherited ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-white'}`}>
                                <option value="">Select…</option>
                                {(field.options ?? []).map(option => (
                                  <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
                                ))}
                              </select>
                            ) : field.type === 'boolean' && (field.required || field.required_when) ? (
                              <select value={rawValue == null ? '' : String(rawValue)}
                                onChange={event => updateDeratingParam(
                                  selectedPartIdx,
                                  field.key,
                                  event.target.value === '' ? null : event.target.value === 'true',
                                )}
                                className={`w-full rounded border px-2 py-1.5 text-xs ${inherited ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-white'}`}>
                                <option value="">Select…</option>
                                <option value="true">Yes</option>
                                <option value="false">No</option>
                              </select>
                            ) : field.type === 'boolean' ? (
                              <label className={`flex h-[30px] items-center gap-2 rounded border px-2 text-xs ${inherited ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-white'}`}>
                                <input type="checkbox" checked={Boolean(effectiveValue)}
                                  onChange={event => updateDeratingParam(selectedPartIdx, field.key, event.target.checked)} />
                                {effectiveValue ? 'Yes' : 'No'}
                              </label>
                            ) : field.type === 'number' ? (
                              <input type="number" min={field.min} max={field.max} step={field.step ?? 'any'}
                                value={effectiveValue == null ? '' : String(effectiveValue)}
                                onChange={event => updateDeratingParam(
                                  selectedPartIdx,
                                  field.key,
                                  event.target.value === '' ? null : Number(event.target.value),
                                )}
                                className={`w-full rounded border px-2 py-1.5 text-xs ${inherited ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-white'}`} />
                            ) : (
                              <input value={effectiveValue == null ? '' : String(effectiveValue)}
                                onChange={event => updateDeratingParam(selectedPartIdx, field.key, event.target.value)}
                                className={`w-full rounded border px-2 py-1.5 text-xs ${inherited ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-white'}`} />
                            )}
                          </div>
                        )
                      })}
                      </div>
                    </div>
                  )}
                  </div>
                </details>
              </section>
            )}

            {/* Source-specific RADC inputs are kept separate from MIL-HDBK-217F inputs. */}
            {standard === 'MIL-HDBK-217F' && (
              <details className="order-[80] rounded-lg border border-cyan-200 bg-cyan-50/50 p-3"
                open={selectedResult?.nonoperating_calculation?.status === 'unavailable' || undefined}>
                <summary className="cursor-pointer select-none text-xs font-semibold text-cyan-950">
                  Nonoperating parameters
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-900">
                    RADC-TR-85-91 model
                  </p>
                  <p className="text-[10px] leading-relaxed text-cyan-800">
                    Automatic mapping uses only exact information already present in the part. Choose an explicit
                    §5.2 model when the operating taxonomy does not establish the required construction or technology.
                    Environment, nonoperating temperature, and power cycling come from the containing system block or mission phase.
                  </p>
                  <div>
                    <label className="block text-[10px] font-medium text-cyan-900">Model mapping</label>
                    <select value={selectedNonoperatingModel}
                      onChange={event => setNonoperatingModel(selectedPartIdx, event.target.value)}
                      className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs">
                      <option value="">Automatic exact mapping</option>
                      {Object.entries(nonoperatingModels)
                        .sort(([, a], [, b]) => a.section.localeCompare(b.section))
                        .map(([model, definition]) => (
                          <option key={model} value={model}>
                            §{definition.section} · {model.replace(/_/g, ' ')}
                          </option>
                        ))}
                    </select>
                  </div>
                  {selectedRADCDefinition && (
                    <p className="text-[9px] text-cyan-700">
                      RADC-TR-85-91 §{selectedRADCDefinition.section}
                      {!selectedNonoperatingModel && selectedAutomaticRADC
                        ? ` · automatic ${selectedAutomaticRADC.model.replace(/_/g, ' ')} mapping`
                        : ''}
                    </p>
                  )}
                  {selectedRADCInputKeys.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {selectedRADCInputKeys.map(key => {
                        const rawValue = selectedPart.nonoperating_params?.[key]
                        const choices = selectedRADCDefinition?.choices?.[key]
                        const label = RADC_PARAMETER_LABELS[key]
                          ?? key.replace(/_/g, ' ').replace(/^./, (value: string) => value.toUpperCase())
                        const help = selectedRADCDefinition?.conditional_parameters?.[key]
                        if (key === 'connection_counts') {
                          const counts = rawValue && typeof rawValue === 'object'
                            ? rawValue as Record<string, unknown> : {}
                          const current = Object.entries(counts)[0] ?? ['', '']
                          const connectionChoices = selectedRADCDefinition?.choices?.connection_type ?? []
                          return (
                            <div key={key} className="col-span-2 grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-medium text-cyan-900">Connection type</label>
                                <select value={current[0]}
                                  onChange={event => updateNonoperatingParam(
                                    selectedPartIdx, key,
                                    event.target.value ? { [event.target.value]: Number(current[1]) || 1 } : null,
                                  )}
                                  className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs">
                                  <option value="">Select…</option>
                                  {connectionChoices.map(choice => <option key={choice} value={choice}>{choice.replace(/_/g, ' ')}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10px] font-medium text-cyan-900">Connection count</label>
                                <input type="number" min={1} step={1} value={current[1] == null ? '' : String(current[1])}
                                  disabled={!current[0]}
                                  onChange={event => updateNonoperatingParam(
                                    selectedPartIdx, key,
                                    current[0] && event.target.value !== ''
                                      ? { [current[0]]: Math.max(1, Number(event.target.value)) }
                                      : null,
                                  )}
                                  className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs disabled:bg-gray-100" />
                              </div>
                            </div>
                          )
                        }
                        return (
                          <div key={key}>
                            <label className="block text-[10px] font-medium text-cyan-900">{label}</label>
                            {choices ? (
                              <select value={rawValue == null ? '' : String(rawValue)}
                                onChange={event => updateNonoperatingParam(selectedPartIdx, key, event.target.value)}
                                className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs">
                                <option value="">Select…</option>
                                {choices.map(choice => <option key={choice} value={choice}>{choice.replace(/_/g, ' ')}</option>)}
                              </select>
                            ) : RADC_NUMERIC_PARAMETERS.has(key) ? (
                              <input type="number" min={0}
                                step={key === 'contact_voltage_mv' || key === 'fiber_length_km' ? 0.1 : 1}
                                value={rawValue == null ? '' : String(rawValue)}
                                onChange={event => updateNonoperatingParam(
                                  selectedPartIdx, key,
                                  event.target.value === '' ? null : Math.max(0, Number(event.target.value)),
                                )}
                                className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs" />
                            ) : (
                              <input value={rawValue == null ? '' : String(rawValue)}
                                onChange={event => updateNonoperatingParam(selectedPartIdx, key, event.target.value)}
                                className="w-full rounded border border-cyan-200 bg-white px-2 py-1.5 text-xs" />
                            )}
                            {help && <p className="mt-0.5 text-[9px] text-cyan-700">{help}</p>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {nonoperatingCatalogLoaded && !selectedNonoperatingModel && !selectedAutomaticRADC && (
                    <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900">
                      This operating category has no automatic exact mapping. Select the applicable RADC model or document a nonoperating-rate override below.
                    </p>
                  )}
                  {selectedResult?.nonoperating_calculation?.status === 'unavailable' && (
                    <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900">
                      <span className="font-semibold">Model unavailable:</span>{' '}
                      {selectedResult.nonoperating_calculation.reason}
                    </p>
                  )}
                </div>

              {/* Explicit nonoperating-rate evidence when no exact RADC model applies. */}
              <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-sky-900">Nonoperating-rate override</p>
                    <p className="text-[10px] text-sky-700">Used only for the nonoperating term; the operating handbook result is preserved.</p>
                  </div>
                  <button type="button" role="switch"
                    aria-checked={selectedPart.nonoperating_rate_override_enabled ?? false}
                    onClick={() => updatePartField(
                      selectedPartIdx,
                      'nonoperating_rate_override_enabled',
                      !(selectedPart.nonoperating_rate_override_enabled ?? false),
                    )}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                      selectedPart.nonoperating_rate_override_enabled ? 'bg-sky-500' : 'bg-gray-300'
                    }`}>
                    <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      selectedPart.nonoperating_rate_override_enabled ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-sky-800">Rate (FPMH/nonop Mh)</label>
                    <input type="number" min={0} step="0.000001"
                      disabled={!selectedPart.nonoperating_rate_override_enabled}
                      value={selectedPart.nonoperating_rate_override_fpmh ?? ''}
                      onChange={event => updatePartField(
                        selectedPartIdx, 'nonoperating_rate_override_fpmh',
                        event.target.value === '' ? null : Math.max(0, Number(event.target.value)))}
                      className="w-full rounded border border-sky-200 bg-white px-2 py-1.5 text-xs font-mono disabled:bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-sky-800">Evidence type</label>
                    <select disabled={!selectedPart.nonoperating_rate_override_enabled}
                      value={selectedPart.nonoperating_rate_source_type ?? ''}
                      onChange={event => updatePartField(
                        selectedPartIdx, 'nonoperating_rate_source_type', event.target.value || null)}
                      className="w-full rounded border border-sky-200 bg-white px-2 py-1.5 text-xs disabled:bg-gray-100">
                      <option value="">Select…</option>
                      <option value="measured">Measured</option>
                      <option value="manufacturer">Manufacturer</option>
                      <option value="qualification_test">Qualification test</option>
                      <option value="engineering_estimate">Engineering estimate</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <label className="mt-2 block text-[10px] font-medium text-sky-800">Source / justification</label>
                <textarea rows={2} disabled={!selectedPart.nonoperating_rate_override_enabled}
                  value={selectedPart.nonoperating_rate_source ?? ''}
                  onChange={event => updatePartField(
                    selectedPartIdx, 'nonoperating_rate_source', event.target.value || null)}
                  placeholder="Report, test record, datasheet, or engineering basis…"
                  className="w-full resize-y rounded border border-sky-200 bg-white px-2 py-1.5 text-xs disabled:bg-gray-100" />
              </div>
              </details>
            )}

            {/* VITA override (MIL-HDBK-217F only) */}
            {standard === 'MIL-HDBK-217F' && VITA_CATEGORIES.has(selectedPart.category) && (
              <div className={`order-3 ${parameterContainerClass('apply_vita')}`}
                onFocusCapture={() => activateParameter('apply_vita')}
                onPointerDown={() => activateParameter('apply_vita')}>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">VITA 51.1 override</label>
                <select
                  value={selectedPart.apply_vita == null ? 'inherit' : selectedPart.apply_vita ? 'on' : 'off'}
                  onChange={e => {
                    const v = e.target.value
                    updatePartField(selectedPartIdx, 'apply_vita', v === 'inherit' ? null : v === 'on')
                  }}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option value="inherit">Use global setting ({vitaGlobal ? 'on' : 'off'})</option>
                  <option value="on">Apply VITA 51.1</option>
                  <option value="off">MIL-HDBK-217F only</option>
                </select>
              </div>
            )}

            {/* Environment override */}
            {standard !== 'FIDES' && !NO_ENV_CATEGORIES.has(selectedPart.category) && (
              <div className={`order-2 ${parameterContainerClass('environment')}`}
                onFocusCapture={() => activateParameter('environment')}
                onPointerDown={() => activateParameter('environment')}>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Environment override</label>
                <select
                  value={selectedPart.environment || ''}
                  onChange={e => updatePartField(selectedPartIdx, 'environment', e.target.value || null)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option value="">Use block/global ({resolveEnvironment({ ...selectedPart, environment: null }) || environment})</option>
                  {getEnvironments(standard).map(env => <option key={env.code} value={env.code}>{env.label}</option>)}
                </select>
              </div>
            )}

            {/* Category-specific parameters */}
            <section className="order-4 space-y-2">
            <h4 className="text-xs font-semibold text-gray-700">{STANDARD_INFO[standard].name} Parameters</h4>
            <div className="space-y-2">
            {(getCategoryFields(standard)[selectedPart.category] ?? []).map(f => (
              <div key={f.key} className={parameterContainerClass(f.key)}
                onFocusCapture={() => activateParameter(f.key)}
                onPointerDown={() => activateParameter(f.key)}>
                <label className="block text-xs font-medium text-gray-500 mb-0.5" title={f.help}>{f.label}</label>
                {f.type === 'select' ? (
                  selectedPart.category === 'parts_count' && f.key === 'part_type' ? (
                    <PartsCountTypePicker
                      value={String(selectedPart.params[f.key] ?? f.default)}
                      catalog={partsCountCatalog}
                      onChange={value => updatePartParam(selectedPartIdx, f.key, value)} />
                  ) : (
                    <select value={String(selectedPart.params[f.key] ?? f.default)}
                      onChange={e => updatePartParam(selectedPartIdx, f.key, e.target.value)}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                      {renderSelectOptions(selectedPart.category, selectedPart.params, f)}
                    </select>
                  )
                ) : f.type === 'text' ? (
                  <input type="text"
                    value={Array.isArray(selectedPart.params[f.key])
                      ? JSON.stringify(selectedPart.params[f.key])
                      : String(selectedPart.params[f.key] ?? f.default)}
                    onChange={e => {
                      const raw = e.target.value
                      if (raw.trim() === '') { updatePartParam(selectedPartIdx, f.key, ''); return }
                      try {
                        const parsed = JSON.parse(raw)
                        updatePartParam(selectedPartIdx, f.key, parsed as [number, number][])
                      } catch {
                        updatePartParam(selectedPartIdx, f.key, raw)
                      }
                    }}
                    placeholder={f.placeholder} title={f.help}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                ) : (
                  <NumberField
                    value={String(selectedPart.params[f.key] ?? f.default)}
                    onChange={v => {
                      const num = parseFloat(v)
                      updatePartParam(selectedPartIdx, f.key, isNaN(num) ? (v as unknown as number) : num)
                    }}
                    semantic={f.label}
                    step={f.step} min={f.min} max={f.max}
                    placeholder={f.placeholder} title={f.help}
                    className="w-full !py-1.5" />
                )}
              </div>
            ))}
            </div>
            </section>

            {/* Pi factors display (from results) */}
            {selectedResult && (() => {
              const base = selectedResult.base_pi_factors
              const showBase = selectedResult.vita && base != null
              // Union of factor keys so both columns line up
              const factorKeys = showBase
                ? Array.from(new Set([
                    ...Object.keys(base!),
                    ...Object.keys(selectedResult.pi_factors),
                  ]))
                : Object.keys(selectedResult.pi_factors)
              const fmtFactor = (v: unknown) =>
                typeof v === 'number' ? v.toFixed(4) : (v == null ? '—' : String(v))
              return (
              <>
                <hr className="order-5 border-gray-200" />
                <h4 className="order-5 text-xs font-semibold text-gray-700">
                  π factors and intermediate terms
                  {selectedResult.vita && (
                    <span className="ml-2 text-[10px] font-normal text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">VITA 51.1 applied</span>
                  )}
                </h4>
                <div className="order-5 border border-gray-200 rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium text-gray-600">Factor</th>
                        {showBase && (
                          <th className="px-2 py-1 text-right font-medium text-gray-600">MIL-HDBK-217F</th>
                        )}
                        <th className="px-2 py-1 text-right font-medium text-gray-600">
                          {showBase ? 'VITA 51.1' : 'Value'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {factorKeys.map(k => {
                        const adj = selectedResult.pi_factors[k]
                        const bv = base?.[k]
                        const changed = showBase && typeof adj === 'number' && typeof bv === 'number'
                          && Math.abs(adj - bv) > 1e-9
                        const direct = directFactorKeys.has(k)
                        const downstream = !direct && downstreamFactorKeys.has(k)
                        const equationHovered = hoveredEquationFactorKey === k
                        return (
                          <tr key={k} className={`border-t transition-colors ${
                            equationHovered
                              ? 'border-indigo-300 border-l-2 border-l-indigo-600 bg-indigo-50 ring-1 ring-inset ring-indigo-200'
                              : direct
                              ? 'border-blue-200 border-l-2 border-l-blue-500 bg-blue-50/80'
                              : downstream
                                ? 'border-sky-100 border-l-2 border-l-sky-300 bg-sky-50/50'
                                : 'border-gray-100'
                          }`}>
                            <td className={`px-2 py-1 font-mono ${selectedResult.vita ? 'text-purple-700' : 'text-gray-700'}`}>
                              {k}
                            </td>
                            {showBase && (
                              <td className="px-2 py-1 text-right font-mono text-gray-500">{fmtFactor(bv)}</td>
                            )}
                            <td className={`px-2 py-1 text-right font-mono ${
                              changed ? 'text-purple-700 font-semibold bg-purple-50'
                                : selectedResult.vita ? 'text-purple-700 font-semibold' : 'text-gray-900'
                            }`}>{fmtFactor(adj)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <details className="order-6 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
                  <summary className="cursor-pointer select-none text-xs font-semibold text-gray-700">
                    Long-form calculation
                  </summary>
                  <div className="mt-3 space-y-2">
                    {standard === 'MIL-HDBK-217F' && selectedResult.traceability && (() => {
                      const trace = selectedResult.traceability
                      return (
                        <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            Operating handbook calculation · {trace.standard} · §{trace.section} · pages {trace.handbook_pages}
                          </span>
                          <p className="text-[11px] font-medium text-gray-700">{trace.model}</p>
                          <div className="select-all overflow-x-auto rounded border border-gray-200 bg-white px-2.5 py-1.5 text-center text-sm font-semibold text-gray-800">
                            <Latex block bindings={trace.symbol_bindings}
                              onBindingHover={handleEquationBindingHover}>
                              {formulaToLatex(trace.equation)}
                            </Latex>
                          </div>
                        </div>
                      )
                    })()}
                    {selectedResult.calculation_steps?.map((step, i) => {
                      const direct = directStepIndices.has(i)
                      const downstream = !direct && downstreamStepIndices.has(i)
                      return (
                      <div key={`${step.symbol}-${i}`} className={`rounded border p-2 text-[10px] space-y-1 transition-colors ${
                        direct
                          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
                          : downstream
                            ? 'border-sky-200 bg-sky-50/60'
                            : 'border-gray-200 bg-gray-50'
                      }`}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-indigo-700">
                            <Latex bindings={step.symbol_bindings}
                              onBindingHover={handleEquationBindingHover}>
                              {formulaToLatex(step.symbol)}
                            </Latex>
                          </span>
                          <span className="font-mono text-gray-900 text-right">{typeof step.value === 'number' ? step.value.toPrecision(7) : step.value} {step.unit === 'dimensionless' ? '' : step.unit}</span>
                        </div>
                        <p className="text-gray-600">{step.description}</p>
                        <CalculationExpression expression={step.expression} latex={step.expression_latex}
                          bindings={step.symbol_bindings} onBindingHover={handleEquationBindingHover} />
                        <p className="font-mono text-gray-500 break-words">{step.substitution}</p>
                      </div>
                    )})}
                    {selectedResult.assumptions && selectedResult.assumptions.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900">
                        <p className="font-semibold mb-1">Handbook assumptions</p>
                        {selectedResult.assumptions.map((item, i) => <p key={i}>• {item}</p>)}
                      </div>
                    )}
                    {selectedResult.warnings && selectedResult.warnings.length > 0 && (
                      <div className="rounded border border-red-200 bg-red-50 p-2 text-[10px] text-red-900">
                        {selectedResult.warnings.map((item, i) => <p key={i}>• {item}</p>)}
                      </div>
                    )}
                  </div>
                </details>
                {showBase && (
                  <p className="order-5 text-[10px] text-gray-400 px-0.5">
                    Highlighted cells differ from the base MIL-HDBK-217F result because an A/V51.1 default, mapping, table extension, conversion, or alternate method was applied.
                  </p>
                )}
                {selectedResult.nonoperating_environment && selectedResult.nonoperating_calculation && selectedResult.effective_operating_fraction != null
                  && selectedResult.effective_operating_fraction < 1 && (
                  <details className="order-[71] rounded border border-sky-200 bg-sky-50/40 text-[10px]">
                    <summary className="cursor-pointer select-none px-2 py-1.5 font-semibold text-sky-900">
                      RADC-TR-85-91 nonoperating calculation
                      {' '}— {selectedResult.nonoperating_calculation.status.replace('_', ' ')}
                    </summary>
                    <div className="space-y-2 border-t border-sky-100 p-2">
                      {selectedResult.nonoperating_calculation.reason && (
                        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
                          {selectedResult.nonoperating_calculation.reason}
                        </p>
                      )}
                      {selectedResult.nonoperating_calculation.model && (
                        <p><span className="font-semibold text-sky-900">Model:</span> {selectedResult.nonoperating_calculation.model}</p>
                      )}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {Object.entries(selectedResult.nonoperating_calculation.factors ?? {}).map(([key, value]) => (
                          <div key={key} className="flex justify-between gap-2 border-b border-sky-100 py-0.5">
                            <span className="font-mono text-sky-800">{key}</span>
                            <span className="font-mono text-gray-900">
                              {typeof value === 'number' ? value.toFixed(4) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {selectedResult.nonoperating_calculation.steps?.map((step, index) => (
                        <div key={`${step.symbol}-nonoperating-${index}`} className="rounded border border-sky-100 bg-white p-2">
                          <div className="flex justify-between gap-2">
                            <span className="font-semibold text-sky-800">
                              <Latex bindings={step.symbol_bindings} onBindingHover={handleEquationBindingHover}>
                                {formulaToLatex(step.symbol)}
                              </Latex>
                            </span>
                            <span className="font-mono text-gray-900">
                              {typeof step.value === 'number' ? step.value.toPrecision(7) : step.value}{' '}
                              {step.unit === 'dimensionless' ? '' : step.unit}
                            </span>
                          </div>
                          <p className="mt-1 text-gray-600">{step.description}</p>
                          <CalculationExpression expression={step.expression} latex={step.expression_latex}
                            bindings={step.symbol_bindings} onBindingHover={handleEquationBindingHover} />
                          <p className="mt-1 break-words font-mono text-gray-500">{step.substitution}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {standard === 'MIL-HDBK-217F' && selectedResult.nonoperating_environment && <section className="order-[70] rounded border border-indigo-200 bg-indigo-50/50 p-2 text-xs">
                  <p className="font-medium text-indigo-900">Calendar-time service exposure</p>
                  <div className="mt-1 overflow-x-auto text-center text-sm text-indigo-950">
                    <Latex block>{'\\lambda_{service}=f_{op}\\lambda_{operating}+(1-f_{op})\\lambda_{nonoperating}'}</Latex>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-indigo-800">
                    fop = {(selectedResult.effective_operating_fraction ?? 1).toFixed(4)}; {' '}
                    λservice = {selectedResult.calculated_failure_rate != null
                      ? `${formatFailureRate(selectedResult.calculated_failure_rate, 8)} ${failureRateUnitLabel}`
                      : 'unavailable'}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded border border-indigo-100 bg-white/80 p-2">
                      <p className="text-gray-500">RADC nonoperating λ</p>
                      {selectedResult.nonoperating_failure_rate_fpmh != null ? (
                        <p className="font-mono font-semibold text-sky-800">
                          {formatFailureRate(selectedResult.nonoperating_failure_rate_fpmh)} <span className="text-gray-400 font-normal">{failureRateUnitLabel}</span>
                        </p>
                      ) : <p className="font-semibold text-amber-700">Unavailable</p>}
                      <p className="mt-0.5 text-[10px] text-gray-400">{selectedResult.nonoperating_environment}</p>
                    </div>
                    <div className="rounded border border-indigo-100 bg-white/80 p-2">
                      <p className="text-gray-500">Calculated service λ</p>
                      {selectedResult.calculated_failure_rate != null ? (
                        <p className="font-mono font-semibold text-indigo-800">
                          {formatFailureRate(selectedResult.calculated_failure_rate)} <span className="text-gray-400 font-normal">{failureRateUnitLabel}</span>
                        </p>
                      ) : <p className="font-semibold text-amber-700">Unavailable</p>}
                    </div>
                  </div>
                </section>}
                <div className="order-5 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-gray-200 p-2">
                    <p className="text-gray-500">Operating handbook λ {showBase && <span className="text-purple-500">(VITA)</span>}</p>
                    <p className={`font-mono font-semibold ${selectedResult.vita ? 'text-purple-700' : 'text-gray-900'}`}>
                      {formatFailureRate(selectedResult.operating_failure_rate_fpmh ?? selectedResult.operating_calculated_failure_rate ?? 0)} <span className="text-gray-400 font-normal">{failureRateUnitLabel}</span>
                    </p>
                    {showBase && selectedResult.base_failure_rate != null && (
                      <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                        MIL-HDBK-217F: {formatFailureRate(selectedResult.base_failure_rate)}
                      </p>
                    )}
                  </div>
                  <div className={`rounded border p-2 ${selectedResult.override_applied ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
                    <p className="text-gray-500">Effective output λ each</p>
                    <p className={`font-mono font-semibold ${selectedResult.override_applied ? 'text-amber-800' : 'text-gray-900'}`}>
                      {selectedResult.failure_rate != null
                        ? formatFailureRate(selectedResult.failure_rate)
                        : 'Unavailable'} <span className="text-gray-400 font-normal">{failureRateUnitLabel}</span>
                    </p>
                    {selectedResult.override_applied && <p className="mt-0.5 text-[10px] text-amber-700">User override applied</p>}
                  </div>
                  <div className="col-span-2 rounded border border-gray-200 p-2">
                    <p className="text-gray-500">Effective line total (piece quantity × multiplier)</p>
                    <p className="font-mono font-semibold text-gray-900">
                      {selectedResult.total_failure_rate != null
                        ? formatFailureRate(selectedResult.total_failure_rate)
                        : 'Unavailable'} <span className="text-gray-400 font-normal">{failureRateUnitLabel}</span>
                    </p>
                  </div>
                </div>
                <div className="order-5 text-xs text-gray-500 rounded border border-gray-200 p-2">
                  <p>Contribution: <span className="font-mono font-semibold text-gray-900">{(selectedResult.contribution * 100).toFixed(1)}%</span></p>
                  {selectedResult.superseded_by_block_id && (
                    <p className="mt-1 text-amber-700">Excluded from the system total because block “{selectedResult.superseded_by_block_id}” has an override.</p>
                  )}
                </div>
              </>
              )
            })()}

            {/* Derating analysis */}
            {deratingEnabled && (
            <div className="order-[91] space-y-2">
              {selectedDeratingFamilies.length === 0 && <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                  <AlertTriangle size={11} className="text-amber-500" /> Derating Analysis
                </h4>
                <button onClick={() => runDerating()} disabled={deratingLoading}
                  className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 disabled:opacity-50">
                  {deratingLoading ? '…' : 'Analyze'}
                </button>
              </div>}
              {deratingError && (
                <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-[10px] text-red-700">
                  {deratingError}
                </div>
              )}
              {deratingResult && selectedPartIdx != null && (() => {
                const dr = deratingResult.results[selectedPartIdx]
                if (!dr || dr.derating.length === 0) return (
                  <div className="rounded border border-gray-200 bg-gray-50 p-2 text-[10px] text-gray-600">
                    <p className="font-semibold">Not evaluated</p>
                    <p className="mt-0.5">{dr?.message ?? 'No verified derating mapping is available for this category.'}</p>
                  </div>
                )
                return (
                  <div className="space-y-1">
                    {(dr.family || dr.subtype) && (
                      <p className="rounded border border-amber-100 bg-amber-50 px-2 py-1 text-[9px] text-amber-900">
                        Source model: <span className="font-semibold">{dr.subtype ?? dr.family}</span>
                        {dr.family && dr.subtype && dr.family !== dr.subtype ? ` (${dr.family})` : ''}
                      </p>
                    )}
                    {dr.derating.map((d, i) => (
                      <div key={i} className={`text-[10px] rounded p-1.5 border ${
                        d.status === 'ok' ? 'bg-emerald-50 border-emerald-200' :
                        d.status === 'exceeds' ? 'bg-red-50 border-red-200' :
                        'bg-gray-50 border-gray-200'
                      }`} title={d.message ?? undefined}>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            d.status === 'ok' ? 'bg-emerald-500' :
                            d.status === 'exceeds' ? 'bg-red-500' : 'bg-gray-400'
                          }`} />
                          <span className="flex-1 text-gray-700">{d.description}</span>
                          <span className="font-mono font-semibold">
                            {formatDeratingValue(d.actual_value, d.unit)}
                          </span>
                          <span className={`text-[9px] font-semibold ${
                            d.status === 'ok' ? 'text-emerald-700' :
                            d.status === 'exceeds' ? 'text-red-700' : 'text-gray-600'
                          }`}>
                            {d.status === 'not_evaluated' ? 'NOT EVALUATED' :
                              d.status === 'exceeds' ? 'EXCEEDS' :
                              d.derating_level ? `Meets Level ${d.derating_level}` : 'OK'}
                          </span>
                        </div>
                        {(d.allowable_value != null || d.formula || d.substitution
                            || (d.message && d.status !== 'ok')
                            || d.source?.section || d.notes?.length) && (
                          <div className="mt-1 pl-4 text-[9px] text-gray-500 space-y-0.5">
                            {d.message && d.status !== 'ok' && (
                              <p className={d.status === 'exceeds' ? 'text-red-700' : 'text-gray-700'}>
                                {d.message}
                              </p>
                            )}
                            {d.allowable_value != null && (
                              <p>
                                Limit: <span className="font-mono">{d.comparison ?? '≤'} {formatDeratingValue(d.allowable_value, d.unit)}</span>
                                {d.margin != null ? ` · margin ${formatDeratingValue(d.margin, d.unit)}` : ''}
                              </p>
                            )}
                            {d.formula && (
                              <details className="rounded border border-gray-200 bg-white px-1.5 py-1">
                                <summary className="cursor-pointer font-medium text-gray-600">Equation and substitution</summary>
                                <div className="mt-1 overflow-x-auto text-[11px] text-gray-800">
                                  <CalculationExpression expression={d.formula} />
                                </div>
                                {d.substitution && (
                                  <div className="mt-1 border-t border-gray-100 pt-1 font-mono text-[9px] text-gray-600">
                                    {d.substitution}
                                  </div>
                                )}
                              </details>
                            )}
                            {!d.formula && d.substitution && (
                              <p className="font-mono">Substitution: {d.substitution}</p>
                            )}
                            {d.source?.section && (
                              <p>
                                Source: {d.source.title ? `${d.source.title} · ` : ''}{d.source.section}
                                {d.source.printed_pages ? ` · p. ${d.source.printed_pages}` : ''}
                                {d.source.pdf_pages ? ` · PDF p. ${d.source.pdf_pages}` : ''}
                              </p>
                            )}
                            {d.notes?.map((note, noteIndex) => (
                              <p key={noteIndex}>Note: {note}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    <p className="text-[9px] text-gray-500">
                      Coverage: {dr.coverage.evaluated}/{dr.coverage.required} required check(s)
                      {dr.selected_level ? `; acceptance target Level ${dr.selected_level}.` : '.'}
                    </p>
                    <p className="text-[9px] text-gray-400">
                      Overall: <span className={`font-semibold ${
                        dr.overall_status === 'ok' ? 'text-emerald-600' :
                        dr.overall_status === 'exceeds' ? 'text-red-600' : 'text-gray-600'
                      }`}>{dr.overall_status.toUpperCase()}</span>
                    </p>
                    {dr.message && <p className="text-[9px] text-gray-500">{dr.message}</p>}
                    {dr.warnings?.map((warning, index) => (
                      <p key={index} className="text-[9px] text-amber-700">⚠ {warning}</p>
                    ))}
                    {((dr.assumptions?.length ?? 0) > 0 || dr.traceability) && (
                      <details className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[9px] text-gray-600">
                        <summary className="cursor-pointer font-medium">Assumptions and source traceability</summary>
                        <div className="mt-1 space-y-1">
                          {dr.assumptions?.map((assumption, index) => (
                            <p key={index}>Assumption: {assumption}</p>
                          ))}
                          {dr.traceability && Object.entries(dr.traceability).map(([key, value]) => (
                            <p key={key}>
                              <span className="font-medium">{key.replace(/_/g, ' ')}:</span>{' '}
                              {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                                ? String(value) : JSON.stringify(value)}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )
              })()}
            </div>
            )}

            {/* Note about re-running */}
            {!selectedResult && result && (
              <p className="order-[100] text-[10px] text-amber-600 bg-amber-50 p-2 rounded">
                Parameters have changed since last prediction. Click "Predict Failure Rate" to recompute.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
    </div>

    {/* Custom Derating Rules editor (modal) */}
    {deratingEnabled && customRulesOpen && deratingStandard === 'Custom' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={() => setCustomRulesOpen(false)}>
        <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-4"
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-purple-800">Custom Derating Rules</h3>
            <div className="flex items-center gap-2">
              <input ref={customRulesFileRef} type="file" accept="application/json,.json" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) importCustomRules(f); e.target.value = '' }} />
              <button onClick={() => customRulesFileRef.current?.click()}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 border border-purple-200 text-purple-700 rounded hover:bg-purple-50">
                <Upload size={11} /> Import
              </button>
              <button onClick={exportCustomRules}
                disabled={Object.keys(customRules).length === 0}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 border border-purple-200 text-purple-700 rounded hover:bg-purple-50 disabled:opacity-40">
                <Download size={11} /> Export
              </button>
              <button onClick={() => setCustomRulesOpen(false)} className="text-xs text-gray-500 hover:text-gray-700 ml-1">Close</button>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            Define custom stress limits per category. Each rule specifies a parameter and three severity level limits (I=tightest, III=loosest). Use unit "ratio" for stress ratios (0–1) or "°C" for temperature limits. Categories with no custom rules fall back to no derating check.
          </p>
          {(['resistor','capacitor','diode','bjt','fet','microcircuit','connector','relay','switch','transformer','inductor','optoelectronic','crystal'] as const).map(cat => {
            const catRules = customRules[cat] || []
            return (
              <div key={cat} className="mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-gray-700 capitalize w-28">{cat}</span>
                  <button
                    onClick={() => {
                      const next = { ...customRules }
                      next[cat] = [...catRules, { param: '', desc: '', unit: 'ratio', level_I: 0.5, level_II: 0.6, level_III: 0.8 }]
                      setCustomRules(next)
                    }}
                    className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 border border-purple-200 rounded hover:bg-purple-200"
                  >
                    + Add Rule
                  </button>
                </div>
                {catRules.length > 0 && (
                  <div className="ml-2 space-y-1">
                    {catRules.map((rule, ri) => (
                      <div key={ri} className="flex items-center gap-1.5 text-[10px]">
                        <input value={rule.param} placeholder="param"
                          onChange={e => {
                            const next = { ...customRules }
                            next[cat] = catRules.map((r, i) => i === ri ? { ...r, param: e.target.value } : r)
                            setCustomRules(next)
                          }}
                          className="w-28 px-1.5 py-0.5 border border-gray-300 rounded text-[10px]" />
                        <input value={rule.desc} placeholder="description"
                          onChange={e => {
                            const next = { ...customRules }
                            next[cat] = catRules.map((r, i) => i === ri ? { ...r, desc: e.target.value } : r)
                            setCustomRules(next)
                          }}
                          className="w-28 px-1.5 py-0.5 border border-gray-300 rounded text-[10px]" />
                        <select value={rule.unit}
                          onChange={e => {
                            const next = { ...customRules }
                            next[cat] = catRules.map((r, i) => i === ri ? { ...r, unit: e.target.value } : r)
                            setCustomRules(next)
                          }}
                          className="w-14 px-1 py-0.5 border border-gray-300 rounded text-[10px]">
                          <option value="ratio">ratio</option>
                          <option value="°C">°C</option>
                        </select>
                        <span className="text-gray-500">I:</span>
                        <input type="number" step="0.01" value={rule.level_I}
                          onChange={e => {
                            const next = { ...customRules }
                            next[cat] = catRules.map((r, i) => i === ri ? { ...r, level_I: parseFloat(e.target.value) || 0 } : r)
                            setCustomRules(next)
                          }}
                          className="w-14 px-1 py-0.5 border border-gray-300 rounded text-[10px]" />
                        <span className="text-gray-500">II:</span>
                        <input type="number" step="0.01" value={rule.level_II}
                          onChange={e => {
                            const next = { ...customRules }
                            next[cat] = catRules.map((r, i) => i === ri ? { ...r, level_II: parseFloat(e.target.value) || 0 } : r)
                            setCustomRules(next)
                          }}
                          className="w-14 px-1 py-0.5 border border-gray-300 rounded text-[10px]" />
                        <span className="text-gray-500">III:</span>
                        <input type="number" step="0.01" value={rule.level_III}
                          onChange={e => {
                            const next = { ...customRules }
                            next[cat] = catRules.map((r, i) => i === ri ? { ...r, level_III: parseFloat(e.target.value) || 0 } : r)
                            setCustomRules(next)
                          }}
                          className="w-14 px-1 py-0.5 border border-gray-300 rounded text-[10px]" />
                        <button onClick={() => {
                          const next = { ...customRules }
                          next[cat] = catRules.filter((_, i) => i !== ri)
                          if (next[cat].length === 0) delete next[cat]
                          setCustomRules(next)
                        }} className="text-red-400 hover:text-red-600 px-1">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setCustomRulesOpen(false)}
              className="text-xs px-3 py-1 border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
              Done
            </button>
            <button onClick={() => { runDerating(); setCustomRulesOpen(false) }} disabled={deratingLoading || parts.length === 0}
              className="text-xs px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
              {deratingLoading ? 'Analyzing...' : 'Apply & Analyze'}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  )
}
