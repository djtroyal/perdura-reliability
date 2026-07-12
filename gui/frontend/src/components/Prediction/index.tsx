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
  analyzeDerating, DeratingResponse, DeratingPartResult, getDeratingStandards, DeratingStandard, CustomDeratingRule,
  predictMissionProfile, MissionPhaseInput, MissionProfileResponse,
  getMissionProfiles, predictMultiStandard, getPredictionStandards, getPartsCountCatalog,
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
const BOOLEAN_OPTIONS = ['true', 'false']

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
  dram: 'DRAM', sram: 'SRAM', sdram: 'SDRAM', nvsram: 'NVSRAM',
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
    { key: 'memory_type', label: 'Memory type (memory devices)', type: 'select', options: ['rom', 'prom', 'uvprom', 'eeprom', 'eaprom', 'dram', 'sram', 'sdram', 'nvsram', 'flash'], default: 'rom', help: 'SDRAM, NVSRAM, and Flash are A/V51.1 mappings to DRAM, SRAM, and Flotox EEPROM.' },
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
      : disclosure.conformance_tier === 'custom'
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
}

interface PredictionState {
  environment: string
  vitaGlobal: boolean
  missionHours: string
  parts: PredictionPart[]
  blocks: SystemBlock[]
  blockSeq: number   // for generating unique block ids
  result?: PredictionResponse | null
}

const INITIAL_STATE: PredictionState = {
  environment: 'GB',
  vitaGlobal: false,
  missionHours: '8760',
  parts: [],
  blocks: [],
  blockSeq: 0,
}

/** Per-part VITA override cycle: inherit (null) -> on (true) -> off (false). */
const nextVita = (v: boolean | null | undefined): boolean | null =>
  v == null ? true : v ? false : null

export default function Prediction() {
  const [state, setState, folios] = useFolioState<PredictionState>('prediction', INITIAL_STATE)
  const { environment, vitaGlobal, missionHours, parts } = state
  const blocks = state.blocks
  const blockSeq = state.blockSeq
  const result = state.result ?? null

  // Prediction standard selector
  const [standard, setStandard] = useState<PredictionStandard>('MIL-HDBK-217F')
  const [processGrade, setProcessGrade] = useState(3)
  const [processScore, setProcessScore] = useState(50)

  // Part editor (transient)
  const [category, setCategory] = useState('microcircuit')
  const [partName, setPartName] = useState('')
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
  const [deratingResult, setDeratingResult] = useState<DeratingResponse | null>(null)
  const [deratingLoading, setDeratingLoading] = useState(false)
  const [deratingLevel, setDeratingLevel] = useState<string>('II')
  const [deratingStandard, setDeratingStandard] = useState<string>('MIL-STD-975')
  const [deratingStandards, setDeratingStandards] = useState<DeratingStandard[]>([])
  const [customRulesOpen, setCustomRulesOpen] = useState(false)
  const [customRules, setCustomRules] = useState<Record<string, CustomDeratingRule[]>>({})
  const [deratingOpen, setDeratingOpen] = useState(false)
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

  useEffect(() => {
    getMissionProfiles().then(setPresetProfiles).catch(() => {})
    getDeratingStandards().then(setDeratingStandards).catch(() => {})
    getPredictionStandards().then(setStandardMethods).catch(() => {})
    getPartsCountCatalog().then(catalog => setPartsCountCatalog(catalog.parts)).catch(() => {})
  }, [])

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

  const selectOptionLabel = (partCategory: string, field: Field, option: string) => {
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
      <option key={option} value={option}>{selectOptionLabel(partCategory, field, option)}</option>
    ))
  }

  const patch = (p: Partial<PredictionState>) => setState(s => ({ ...s, ...p }))
  // Any change to inputs invalidates the previous run
  const patchInputs = (p: Partial<PredictionState>) =>
    setState(s => ({ ...s, ...p, result: null }))

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
    })
    // Keep every mission phase on a valid environment for the new standard.
    setMissionPhases(phases =>
      phases.map(ph => ({ ...ph, environment: mapEnvironment(ph.environment, prevStandard, s) }))
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
        quantity: qty,
        params: cleaned,
        apply_vita: editorVita === 'inherit' ? null : editorVita === 'on',
        environment: editorEnv || null,
        parentId: editorParentId || null,
      }],
    })
    setPartName('')
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
    patch({
      blocks: [...blocks, { id: `b${blockSeq + 1}`, name, parentId: blockParentId || null }],
      blockSeq: blockSeq + 1,
    })
    setBlockName('')
  }

  const renameBlock = (id: string) => {
    const blk = blocks.find(b => b.id === id)
    if (!blk) return
    const name = window.prompt('Block name:', blk.name)
    if (name && name.trim()) {
      patch({ blocks: blocks.map(b => b.id === id ? { ...b, name: name.trim() } : b) })
    }
  }

  /** Delete a block; its child parts and child blocks move up to the block's parent. */
  const deleteBlock = (id: string) => {
    const blk = blocks.find(b => b.id === id)
    if (!blk) return
    const parent = blk.parentId ?? null
    patch({
      blocks: blocks
        .filter(b => b.id !== id)
        .map(b => (b.parentId === id ? { ...b, parentId: parent } : b)),
      parts: parts.map(p => ((p.parentId ?? null) === id ? { ...p, parentId: parent } : p)),
    })
  }

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
    (updater: (parts: PredictionPart[]) => PredictionPart[]) =>
      setState(s => ({ ...s, parts: updater(s.parts), result: null })),
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

  const selectedPart = selectedPartIdx != null ? parts[selectedPartIdx] : null
  const selectedResult = selectedPartIdx != null ? result?.results[selectedPartIdx] : null
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
    if (parts.length === 0) { setError('Add at least one part.'); return }
    setError(null)
    setLoading(true)
    try {
      const apiParts = parts.map(({ parentId: _parentId, ...rest }) => ({
        ...rest,
        // Blank optional controls are an editor state, not a numerical value.
        // Omit them so the model receives None/default rather than float('').
        params: Object.fromEntries(Object.entries(rest.params).filter(([, value]) =>
          !(typeof value === 'string' && value.trim() === ''))),
        environment: resolveEnvironment({ ...rest, parentId: _parentId }) || undefined,
      }))
      let res: PredictionResponse
      if (standard === 'MIL-HDBK-217F') {
        res = await predictFailureRate({ environment, vita_global: vitaGlobal, parts: apiParts })
      } else {
        res = await predictMultiStandard({
          standard,
          environment,
          vita_global: vitaGlobal,
          parts: apiParts,
          process_grade: processGrade,
          process_score: processScore,
        })
      }
      patch({ result: res })
      // Auto-run derating analysis after successful prediction
      if (parts.length > 0) {
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
    setDeratingLoading(true)
    try {
      const apiParts = parts.map(({ parentId: _parentId, ...rest }) => rest)
      const effectiveStd = std ?? deratingStandard
      const rules = effectiveStd === 'Custom' && Object.keys(customRules).length > 0 ? customRules : undefined
      const res = await analyzeDerating(apiParts, level ?? deratingLevel, effectiveStd, rules)
      setDeratingResult(res)
    } catch { setDeratingResult(null) }
    finally { setDeratingLoading(false) }
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
      temperature: 40, operating: true, duty_cycle: 1.0, description: '',
    }])
  }
  const removeMissionPhase = (idx: number) => {
    setMissionPhases(prev => prev.filter((_, i) => i !== idx))
  }
  const updateMissionPhase = (idx: number, field: string, value: string | number | boolean) => {
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
        prediction: { environment, vitaGlobal, missionHours, parts, blocks, blockSeq },
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
          parts: nextParts,
          blocks: nextBlocks,
          blockSeq: nextSeq,
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
    if (!result || result.total_failure_rate <= 0) return []
    const tMax = Math.max(parseFloat(missionHours) || 8760, 1) * 2
    const n = 200
    const t: number[] = []
    const R: number[] = []
    for (let i = 0; i <= n; i++) {
      const ti = (tMax * i) / n
      t.push(ti)
      R.push(Math.exp(-result.total_failure_rate * ti / 1e6))
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

  // Contribution pie chart data: aggregate by top-level system block
  // (or the part's own name if it sits at root level)
  const contributionPie = useMemo(() => {
    if (!result || result.results.length === 0) return null
    const blockById = new Map(blocks.map(b => [b.id, b]))
    const topLevelBlockName = (parentId: string | null | undefined): string | null => {
      let cur = parentId != null ? blockById.get(parentId) : undefined
      if (!cur) return null
      const seen = new Set<string>()
      while (cur.parentId != null && blockById.has(cur.parentId) && !seen.has(cur.id)) {
        seen.add(cur.id)
        cur = blockById.get(cur.parentId)!
      }
      return cur.name
    }
    const sliceMap = new Map<string, number>()
    result.results.forEach((r, i) => {
      const label = topLevelBlockName(parts[i]?.parentId)
        ?? (parts[i]?.name || `${getCategoryLabels(standard)[parts[i]?.category] ?? parts[i]?.category} ${i + 1}`)
      sliceMap.set(label, (sliceMap.get(label) ?? 0) + r.total_failure_rate)
    })
    const labels = [...sliceMap.keys()]
    const values = [...sliceMap.values()]
    return { labels, values }
  }, [result, blocks, parts, standard])

  const missionR = useMemo(() => {
    if (!result) return null
    const tm = parseFloat(missionHours)
    if (isNaN(tm) || tm <= 0) return null
    return Math.exp(-result.total_failure_rate * tm / 1e6)
  }, [result, missionHours])

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
                      <input type="number" value={ph.duration} min={0} step={100}
                        onChange={e => updateMissionPhase(i, 'duration', parseFloat(e.target.value) || 0)}
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
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[10px] text-gray-600">
                      <input type="checkbox" checked={ph.operating}
                        onChange={e => updateMissionPhase(i, 'operating', e.target.checked)}
                        className="w-3 h-3" />
                      Operating
                    </label>
                    <div className="flex-1">
                      <label className="text-[9px] text-gray-400">Duty cycle</label>
                      <input type="number" value={ph.duty_cycle} min={0} max={1} step={0.1}
                        onChange={e => updateMissionPhase(i, 'duty_cycle', parseFloat(e.target.value) || 1)}
                        className="w-full text-[10px] border rounded px-1 py-0.5" />
                    </div>
                  </div>
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
                  <p>System λ = {missionResult.system_failure_rate.toFixed(6)} FPMH</p>
                  <p>MTBF = {missionResult.system_mtbf?.toLocaleString() ?? '—'} hrs</p>
                  <p>R(mission) = {missionResult.mission_reliability.toFixed(6)}</p>
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
          <button onClick={() => setDeratingOpen(!deratingOpen)}
            className="flex items-center gap-1.5 w-full text-left text-xs font-semibold text-gray-700 hover:text-gray-900">
            {deratingOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <AlertTriangle size={12} className="text-amber-500" />
            Derating
            <span className="ml-auto text-[10px] text-amber-600 font-normal">
              {deratingStandard === 'Custom' ? 'Custom' : deratingStandard}
            </span>
          </button>
          {deratingOpen && (
            <div className="mt-2 space-y-2">
              <div>
                <label className="block text-[10px] font-medium text-gray-600 mb-1">Derating Standard</label>
                <select
                  value={deratingStandard}
                  onChange={e => { setDeratingStandard(e.target.value); if (parts.length > 0) runDerating(undefined, e.target.value) }}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  {deratingStandards.map(s => (
                    <option key={s.key} value={s.key}>{s.name}</option>
                  ))}
                  <option value="Custom">Custom Rules</option>
                </select>
                {deratingStandard !== 'Custom' && (
                  <p className="text-[10px] text-gray-500 mt-1 px-0.5">
                    {deratingStandards.find(s => s.key === deratingStandard)?.description}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-600 mb-1">Severity Level</label>
                <select
                  value={deratingLevel}
                  onChange={e => { setDeratingLevel(e.target.value); if (parts.length > 0) runDerating(e.target.value) }}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  <option value="I">Level I — Best practice (tightest)</option>
                  <option value="II">Level II — Standard</option>
                  <option value="III">Level III — Minimum acceptable</option>
                </select>
              </div>
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
                Derating analysis runs automatically after each prediction. The full per-part report appears in the results panel.
              </p>
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
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Reference designator <span className="text-gray-400">(optional)</span>
              </label>
              <input type="text" value={partName} onChange={e => setPartName(e.target.value)}
                placeholder="e.g. U1, R10-R29"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
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
          <label className="flex-1 text-xs font-medium text-gray-700"
            title="Operating time used to convert the system failure rate into mission reliability R(t) = exp(−λ·t).">
            Mission time <span className="font-normal text-gray-400">(hours)</span>
          </label>
          <input type="number" min={0} step={100} value={missionHours} onChange={e => patch({ missionHours: e.target.value })}
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
      <div className={`flex-1 overflow-y-auto p-6 min-w-0 ${selectedPart ? 'pr-0' : ''}`}>
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
                    <th className="px-3 py-2 text-right font-medium text-gray-600">λ each (FPMH)</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">λ total (FPMH)</th>
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
                      const blockLambda = result ? partIndices.reduce(
                        (s, i) => s + (result.results[i]?.total_failure_rate ?? 0), 0) : null
                      const blockContrib = result ? partIndices.reduce(
                        (s, i) => s + (result.results[i]?.contribution ?? 0), 0) : null
                      const isActive = editorParentId === block.id
                      const isDropHere = dropTarget === block.id
                      return (
                        <tr key={`b:${block.id}`}
                          onDragOver={e => { e.stopPropagation(); onDropTargetOver(e, block.id) }}
                          onDragLeave={() => { if (dropTarget === block.id) setDropTarget(null) }}
                          onDrop={e => onPaletteDrop(e, block.id)}
                          className={`border-t border-gray-200 cursor-pointer hover:bg-gray-100 group ${
                            isDropHere ? 'bg-blue-100 ring-1 ring-inset ring-blue-400'
                              : isActive ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-300' : 'bg-gray-50/70'
                          }`}
                          onClick={() => {
                            toggleBlock(block.id)
                            setEditorParentId(prev => prev === block.id ? '' : block.id)
                            setBlockParentId(prev => prev === block.id ? '' : block.id)
                          }}>
                          <td colSpan={5} className="py-1.5 font-semibold text-gray-700"
                            style={{ paddingLeft: 12 + row.depth * 20 }}>
                            <span className="inline-flex items-center gap-1">
                              {isCollapsed
                                ? <><Folder size={12} className="text-gray-400" /><ChevronRight size={12} className="text-gray-400" /></>
                                : <><FolderOpen size={12} className="text-blue-400" /><ChevronDown size={12} className="text-gray-400" /></>}
                              <span title="Double-click to rename"
                                onDoubleClick={e => { e.stopPropagation(); renameBlock(block.id) }}>
                                {block.name}
                              </span>
                            </span>
                            <span className="text-gray-400 font-normal ml-1">
                              ({partIndices.length} part{partIndices.length === 1 ? '' : 's'})
                            </span>
                          </td>
                          <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
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
                              {ENVIRONMENTS.map(env => <option key={env.code} value={env.code}>{env.code}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">
                            {blockLambda != null ? blockLambda.toFixed(5) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">
                            {blockContrib != null ? `${(blockContrib * 100).toFixed(1)}%` : '—'}
                          </td>
                          <td></td>
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
                  {result.total_failure_rate.toFixed(4)} <span className="text-xs font-normal">/10⁶ h</span>
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
            {deratingResult && (
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
                        <option key={s.key} value={s.key}>{s.name}</option>
                      ))}
                      <option value="Custom">Custom Rules</option>
                    </select>
                    {deratingStandard === 'Custom' && (
                      <button onClick={() => setCustomRulesOpen(o => !o)}
                        className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100">
                        Edit Rules
                      </button>
                    )}
                    <select
                      value={deratingLevel}
                      onChange={e => { setDeratingLevel(e.target.value); runDerating(e.target.value); }}
                      className="text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-white text-gray-700"
                    >
                      <option value="I">Level I</option>
                      <option value="II">Level II</option>
                      <option value="III">Level III</option>
                    </select>
                    <div className="flex gap-1.5">
                      {deratingResult.summary.ok > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                          {deratingResult.summary.ok} OK
                        </span>
                      )}
                      {deratingResult.summary.warning > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          {deratingResult.summary.warning} Warning
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
                              dr.overall_status === 'warning' ? 'bg-amber-100 text-amber-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {dr.overall_status === 'ok' ? 'OK' : dr.overall_status === 'warning' ? 'WARNING' : 'EXCEEDS'}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-gray-600">
                            {dr.derating.length === 0 ? (
                              <span className="text-gray-400 italic">No rules</span>
                            ) : (
                              <span className="flex flex-wrap gap-1">
                                {dr.derating.map((d, di) => (
                                  <span key={di} className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded ${
                                    d.status === 'ok' ? 'bg-green-50 text-green-700' :
                                    d.status === 'warning' ? 'bg-amber-50 text-amber-700' :
                                    'bg-red-50 text-red-700'
                                  }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                      d.status === 'ok' ? 'bg-green-500' :
                                      d.status === 'warning' ? 'bg-amber-500' : 'bg-red-500'
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
            <div className={`grid gap-4 ${reliabilityPlot.length > 0 && contributionPie ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
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
            {contributionPie && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Failure Rate Contribution</h3>
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 320 }}>
                  <Plot
                    data={[{
                      labels: contributionPie.labels,
                      values: contributionPie.values,
                      type: 'pie',
                      textinfo: 'label+percent',
                      textposition: 'inside',
                      hovertemplate: '%{label}<br>%{value:.5f} FPMH<br>%{percent}<extra></extra>',
                      marker: {
                        colors: contributionPie.labels.map((_, i) => {
                          const palette = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#e11d48']
                          return palette[i % palette.length]
                        }),
                      },
                    }] as Plotly.Data[]}
                    layout={{
                      margin: { t: 20, r: 20, b: 20, l: 20 },
                      paper_bgcolor: 'white',
                      showlegend: contributionPie.labels.length <= 12,
                      legend: { font: { size: 9 }, orientation: 'v', x: 1.02, y: 1 },
                    } as any}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
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
            {/* Category (read-only) */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-0.5">Category</label>
              <p className="text-xs font-semibold text-gray-800">{getCategoryLabels(standard)[selectedPart.category] ?? selectedPart.category}</p>
            </div>

            {/* Editable name */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-0.5">Reference designator</label>
              <input type="text" value={selectedPart.name ?? ''}
                onFocus={() => setActiveParameter(null)}
                onChange={e => updatePartField(selectedPartIdx, 'name', e.target.value || undefined)}
                placeholder="e.g. U1, R10"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>

            {/* Quantity + Multiplier + Parent block */}
            <div className="grid grid-cols-3 gap-2" onFocusCapture={() => setActiveParameter(null)}>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Quantity</label>
                <input type="number" min={1} step={1} value={selectedPart.quantity}
                  onChange={e => { const n = parseInt(e.target.value, 10); updatePartField(selectedPartIdx, 'quantity', isNaN(n) || n < 1 ? 1 : n) }}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Multiplier</label>
                <input type="number" step={0.05} min={0} value={Number(selectedPart.params.multiplier ?? 1)}
                  onChange={e => { const n = parseFloat(e.target.value); updatePartParam(selectedPartIdx, 'multiplier', isNaN(n) || n <= 0 ? 1 : n) }}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Parent block</label>
                <select value={selectedPart.parentId ?? ''}
                  onChange={e => updatePartField(selectedPartIdx, 'parentId', e.target.value || null)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  {blockOptions}
                </select>
              </div>
            </div>

            {/* VITA override (MIL-HDBK-217F only) */}
            {standard === 'MIL-HDBK-217F' && VITA_CATEGORIES.has(selectedPart.category) && (
              <div className={parameterContainerClass('apply_vita')}
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
              <div className={parameterContainerClass('environment')}
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

            <hr className="border-gray-200" />

            {/* Formula and citation come from the calculation result itself so
                UI text cannot drift from the model that actually ran. */}
            {standard === 'MIL-HDBK-217F' && selectedResult?.traceability && (() => {
              const trace = selectedResult.traceability!
              return (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                      {trace.standard} · §{trace.section} · pages {trace.handbook_pages}
                    </span>
                  </div>
                  <p className="text-[11px] font-medium text-gray-700">{trace.model}</p>
                  <div className="text-sm font-semibold text-gray-800 bg-white border border-gray-200 rounded px-2.5 py-1.5 text-center select-all overflow-x-auto">
                    <Latex block bindings={trace.symbol_bindings}
                      onBindingHover={handleEquationBindingHover}>
                      {formulaToLatex(trace.equation)}
                    </Latex>
                  </div>
                </div>
              )
            })()}

            {/* Category-specific parameters */}
            <h4 className="text-xs font-semibold text-gray-700">{STANDARD_INFO[standard].name} Parameters</h4>
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
                    step={f.step} min={f.min} max={f.max}
                    placeholder={f.placeholder} title={f.help}
                    className="w-full !py-1.5" />
                )}
              </div>
            ))}

            {/* Per-part notes */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-0.5 flex items-center gap-1">
                <StickyNote size={11} className="text-amber-400" /> Notes
              </label>
              <textarea
                rows={2}
                value={selectedPart.notes ?? ''}
                onFocus={() => setActiveParameter(null)}
                onChange={e => updatePartField(selectedPartIdx, 'notes', e.target.value || undefined)}
                placeholder="Custom notes about this part (part number, supplier, rationale…)"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>

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
                <hr className="border-gray-200" />
                <h4 className="text-xs font-semibold text-gray-700">
                  Computed factors and intermediate terms
                  {selectedResult.vita && (
                    <span className="ml-2 text-[10px] font-normal text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">VITA 51.1 applied</span>
                  )}
                </h4>
                <div className="border border-gray-200 rounded overflow-hidden">
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
                {selectedResult.calculation_steps && selectedResult.calculation_steps.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-gray-700">Long-form calculation</h4>
                    {selectedResult.calculation_steps.map((step, i) => {
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
                  </div>
                )}
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
                {showBase && (
                  <p className="text-[10px] text-gray-400 px-0.5">
                    Highlighted cells differ from the base MIL-HDBK-217F result because an A/V51.1 default, mapping, table extension, conversion, or alternate method was applied.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-gray-200 p-2">
                    <p className="text-gray-500">λ each {showBase && <span className="text-purple-500">(VITA)</span>}</p>
                    <p className={`font-mono font-semibold ${selectedResult.vita ? 'text-purple-700' : 'text-gray-900'}`}>
                      {selectedResult.failure_rate.toFixed(5)} <span className="text-gray-400 font-normal">FPMH</span>
                    </p>
                    {showBase && selectedResult.base_failure_rate != null && (
                      <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                        MIL-HDBK-217F: {selectedResult.base_failure_rate.toFixed(5)}
                      </p>
                    )}
                  </div>
                  <div className="rounded border border-gray-200 p-2">
                    <p className="text-gray-500">λ total (qty x mult)</p>
                    <p className={`font-mono font-semibold ${selectedResult.vita ? 'text-purple-700' : 'text-gray-900'}`}>
                      {selectedResult.total_failure_rate.toFixed(5)} <span className="text-gray-400 font-normal">FPMH</span>
                    </p>
                    {showBase && selectedResult.base_total_failure_rate != null && (
                      <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                        MIL-HDBK-217F: {selectedResult.base_total_failure_rate.toFixed(5)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-500 rounded border border-gray-200 p-2">
                  <p>Contribution: <span className="font-mono font-semibold text-gray-900">{(selectedResult.contribution * 100).toFixed(1)}%</span></p>
                </div>
              </>
              )
            })()}

            {/* Derating analysis */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                  <AlertTriangle size={11} className="text-amber-500" /> Derating Analysis
                </h4>
                <button onClick={() => runDerating()} disabled={deratingLoading}
                  className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 disabled:opacity-50">
                  {deratingLoading ? '…' : 'Analyze'}
                </button>
              </div>
              {deratingResult && selectedPartIdx != null && (() => {
                const dr = deratingResult.results[selectedPartIdx]
                if (!dr || dr.derating.length === 0) return (
                  <p className="text-[10px] text-gray-400">No derating rules for this category.</p>
                )
                return (
                  <div className="space-y-1">
                    {dr.derating.map((d, i) => (
                      <div key={i} className={`flex items-center gap-2 text-[10px] rounded p-1.5 border ${
                        d.status === 'ok' ? 'bg-emerald-50 border-emerald-200' :
                        d.status === 'warning' ? 'bg-amber-50 border-amber-200' :
                        'bg-red-50 border-red-200'
                      }`}>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          d.status === 'ok' ? 'bg-emerald-500' :
                          d.status === 'warning' ? 'bg-amber-500' : 'bg-red-500'
                        }`} />
                        <span className="flex-1 text-gray-700">{d.description}</span>
                        <span className="font-mono font-semibold">{
                          d.stress_ratio != null ? `${(d.stress_ratio * 100).toFixed(0)}%` :
                          d.actual_value != null ? `${d.actual_value}°C` : '—'
                        }</span>
                        <span className={`text-[9px] font-semibold ${
                          d.status === 'ok' ? 'text-emerald-700' :
                          d.status === 'warning' ? 'text-amber-700' : 'text-red-700'
                        }`}>
                          {d.derating_level === 'exceeded' ? 'EXCEEDS' : `Level ${d.derating_level}`}
                        </span>
                      </div>
                    ))}
                    <p className="text-[9px] text-gray-400">
                      Overall: <span className={`font-semibold ${
                        dr.overall_status === 'ok' ? 'text-emerald-600' :
                        dr.overall_status === 'warning' ? 'text-amber-600' : 'text-red-600'
                      }`}>{dr.overall_status.toUpperCase()}</span>
                    </p>
                  </div>
                )
              })()}
            </div>

            {/* Note about re-running */}
            {!selectedResult && result && (
              <p className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded">
                Parameters have changed since last prediction. Click "Predict Failure Rate" to recompute.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
    </div>

    {/* Custom Derating Rules editor (modal) */}
    {customRulesOpen && deratingStandard === 'Custom' && (
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
