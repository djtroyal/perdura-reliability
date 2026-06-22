import { useState, useRef, useEffect } from 'react'
import Plot from '../shared/ExportablePlot'
import {
  Play, Plus, Trash2, Upload, Download, X, ChevronRight, ChevronDown,
  FolderOpen, Folder, Box, Cpu, Triangle, CircuitBoard, Zap, Lightbulb,
  Battery, Magnet, ToggleRight, ToggleLeft, Plug, Cable, Fan, Diamond,
  Filter, RectangleHorizontal, StickyNote, Gauge, Shield, MonitorSpeaker,
  Activity, Disc, AlertTriangle, Clock, Map as MapIcon,
} from 'lucide-react'
import {
  predictFailureRate, PredictionPart, PredictionResponse,
  analyzeDerating, DeratingResponse, DeratingPartResult, getDeratingStandards, DeratingStandard, CustomDeratingRule,
  predictMissionProfile, MissionPhaseInput, MissionProfileResponse,
  getMissionProfiles, predictMultiStandard,
} from '../../api/client'
import { useFolioState } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import ExportResultsButton from '../shared/ExportResultsButton'
import NumberField from '../shared/NumberField'
import { paletteGroupsFor, PALETTE_DND_TYPE, PaletteItem } from './palette'

// Icon + accent color per component category, shown in the Parts List.
const CATEGORY_ICONS: Record<string, { Icon: typeof Cpu; color: string }> = {
  microcircuit: { Icon: Cpu, color: 'text-indigo-500' },
  hybrid_microcircuit: { Icon: CircuitBoard, color: 'text-indigo-600' },
  diode: { Icon: Triangle, color: 'text-rose-500' },
  hf_diode: { Icon: Triangle, color: 'text-rose-400' },
  bjt: { Icon: CircuitBoard, color: 'text-emerald-500' },
  fet: { Icon: CircuitBoard, color: 'text-teal-500' },
  gaas_fet: { Icon: CircuitBoard, color: 'text-teal-400' },
  unijunction: { Icon: CircuitBoard, color: 'text-emerald-400' },
  thyristor: { Icon: Zap, color: 'text-amber-500' },
  optoelectronic: { Icon: Lightbulb, color: 'text-yellow-500' },
  tube: { Icon: MonitorSpeaker, color: 'text-orange-600' },
  laser: { Icon: Activity, color: 'text-red-400' },
  resistor: { Icon: RectangleHorizontal, color: 'text-orange-500' },
  capacitor: { Icon: Battery, color: 'text-sky-500' },
  inductive: { Icon: Magnet, color: 'text-purple-500' },
  relay: { Icon: ToggleRight, color: 'text-cyan-500' },
  ss_relay: { Icon: ToggleRight, color: 'text-cyan-400' },
  switch: { Icon: ToggleLeft, color: 'text-blue-500' },
  circuit_breaker: { Icon: Shield, color: 'text-blue-600' },
  connector: { Icon: Plug, color: 'text-lime-600' },
  pcb: { Icon: CircuitBoard, color: 'text-emerald-600' },
  connection: { Icon: Cable, color: 'text-stone-500' },
  rotating: { Icon: Fan, color: 'text-green-500' },
  meter: { Icon: Gauge, color: 'text-slate-500' },
  crystal: { Icon: Diamond, color: 'text-fuchsia-500' },
  lamp: { Icon: Lightbulb, color: 'text-amber-400' },
  filter: { Icon: Filter, color: 'text-violet-500' },
  fuse: { Icon: Zap, color: 'text-red-500' },
  miscellaneous: { Icon: Disc, color: 'text-gray-500' },
  custom: { Icon: Box, color: 'text-gray-400' },
  generic: { Icon: Box, color: 'text-gray-400' },
}

function CategoryIcon({ category }: { category: string }) {
  const { Icon, color } = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.generic
  return <Icon size={13} className={`flex-shrink-0 ${color}`} />
}

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
  type: 'number' | 'select'
  options?: string[]
  default: string | number
  // Bounded increments for numeric fields (#2). Omitted -> NumberField auto-steps.
  step?: number
  min?: number
  max?: number
}

const CATEGORY_FIELDS: Record<string, Field[]> = {
  microcircuit: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['digital', 'linear', 'microprocessor', 'memory'], default: 'digital' },
    { key: 'technology', label: 'Technology', type: 'select', options: ['mos', 'bipolar'], default: 'mos' },
    { key: 'complexity', label: 'Gates / transistors / bits', type: 'number', default: 1000, step: 100, min: 1 },
    { key: 'pins', label: 'Pins', type: 'number', default: 16, step: 1, min: 1 },
    { key: 'package', label: 'Package', type: 'select', options: ['nonhermetic', 'hermetic_dip', 'glass_dip', 'flatpack', 'can'], default: 'nonhermetic' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'B', 'B-1', 'commercial'], default: 'commercial' },
    { key: 'years_in_production', label: 'Years in production', type: 'number', default: 2, step: 1, min: 0 },
  ],
  hybrid_microcircuit: [
    { key: 'sum_Ni_lambda_ci', label: 'Σ(Ni·λci) die elements', type: 'number', default: 0.01, step: 0.001, min: 0 },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'function_factor', label: 'Function factor (πF)', type: 'number', default: 1, step: 0.5, min: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'B', 'B-1', 'commercial'], default: 'commercial' },
    { key: 'years_in_production', label: 'Years in production', type: 'number', default: 2, step: 1, min: 0 },
  ],
  diode: [
    { key: 'diode_type', label: 'Diode type', type: 'select', options: ['general_purpose', 'switching', 'power_rectifier', 'fast_recovery_rectifier', 'schottky', 'zener_regulator', 'voltage_reference', 'transient_suppressor'], default: 'general_purpose' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'contact', label: 'Contact construction', type: 'select', options: ['bonded', 'spring'], default: 'bonded' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  hf_diode: [
    { key: 'diode_type', label: 'Diode type', type: 'select', options: ['varactor', 'step_recovery', 'gunn', 'impatt', 'tunnel', 'pin', 'mixer', 'detector'], default: 'varactor' },
    { key: 'application', label: 'Application', type: 'select', options: ['oscillator', 'mixer', 'detector', 'amplifier', 'switch'], default: 'detector' },
    { key: 'rated_power', label: 'Rated power (W)', type: 'number', default: 0.5, step: 0.1, min: 0 },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  bjt: [
    { key: 'application', label: 'Application', type: 'select', options: ['switching', 'linear'], default: 'switching' },
    { key: 'rated_power', label: 'Rated power (W)', type: 'number', default: 0.5, step: 0.1, min: 0 },
    { key: 'voltage_stress', label: 'Voltage stress (VCE/VCEO)', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  fet: [
    { key: 'fet_type', label: 'FET type', type: 'select', options: ['mosfet', 'jfet'], default: 'mosfet' },
    { key: 'application', label: 'Application', type: 'select', options: ['switching', 'linear', 'power_2_5W', 'power_5_50W', 'power_50_250W', 'power_gt_250W'], default: 'switching' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  gaas_fet: [
    { key: 'power_class', label: 'Power class', type: 'select', options: ['low_power', 'power'], default: 'low_power' },
    { key: 'application', label: 'Application', type: 'select', options: ['low_noise', 'driver', 'power', 'switch'], default: 'low_noise' },
    { key: 'matching', label: 'Device type', type: 'select', options: ['jfet', 'mesfet', 'hemt', 'phemt'], default: 'mesfet' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  unijunction: [
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  resistor: [
    { key: 'style', label: 'Style', type: 'select', options: ['film', 'composition', 'wirewound', 'wirewound_power', 'chip', 'network', 'thermistor', 'variable_film', 'variable_wirewound', 'variable_composition', 'RC', 'RCR', 'RL', 'RLR', 'RN', 'RD', 'RM', 'RZ', 'RW', 'RWR', 'RE', 'RER', 'RB', 'RTH', 'RT', 'RR', 'RA', 'RP'], default: 'film' },
    { key: 'resistance', label: 'Resistance (Ω)', type: 'number', default: 10000, step: 100, min: 0 },
    { key: 'rated_power', label: 'Rated power (W)', type: 'number', default: 0.5, step: 0.1, min: 0 },
    { key: 'power_stress', label: 'Power stress (P/Prated)', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_ambient', label: 'Ambient temp (°C)', type: 'number', default: 40, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'non-ER', 'commercial'], default: 'commercial' },
  ],
  capacitor: [
    { key: 'style', label: 'Style', type: 'select', options: ['ceramic', 'tantalum_solid', 'tantalum_wet', 'aluminum_electrolytic', 'plastic_film', 'mica', 'glass', 'paper', 'variable_ceramic', 'variable_air', 'CA', 'CK', 'CDR', 'CP', 'CSR', 'CWR', 'CS', 'CL', 'CU', 'CE', 'CM', 'CQ', 'CFR', 'PC', 'CT', 'CG'], default: 'ceramic' },
    { key: 'capacitance', label: 'Capacitance (µF)', type: 'number', default: 0.1, step: 0.1, min: 0 },
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_ambient', label: 'Ambient temp (°C)', type: 'number', default: 40, step: 5, min: -65, max: 200 },
    { key: 'circuit_resistance', label: 'Circuit resistance (Ω/V, tantalum)', type: 'number', default: 1.0, step: 0.1, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'L', 'non-ER', 'commercial'], default: 'commercial' },
  ],
  thyristor: [
    { key: 'rated_current', label: 'Rated current (A)', type: 'number', default: 1, step: 0.5, min: 0 },
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  optoelectronic: [
    { key: 'device', label: 'Device', type: 'select', options: ['led', 'photodiode', 'phototransistor', 'optocoupler', 'alphanumeric_display'], default: 'led' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  tube: [
    { key: 'tube_type', label: 'Tube type', type: 'select', options: ['triode', 'tetrode', 'pentode', 'klystron', 'traveling_wave_tube', 'magnetron', 'crt', 'vidicon', 'thyratron', 'cross_field_amplifier'], default: 'pentode' },
    { key: 'usage', label: 'Usage', type: 'select', options: ['continuous', 'pulsed'], default: 'continuous' },
    { key: 'utilization_factor', label: 'Utilization factor', type: 'number', default: 1, step: 0.1, min: 0 },
  ],
  laser: [
    { key: 'laser_type', label: 'Laser type', type: 'select', options: ['helium_neon', 'argon', 'carbon_dioxide', 'solid_state_nd_yag', 'semiconductor_cw', 'semiconductor_pulsed'], default: 'semiconductor_cw' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['single_mode', 'multimode', 'q_switched'], default: 'single_mode' },
    { key: 'application', label: 'Application', type: 'select', options: ['communications', 'rangefinding', 'tracking', 'weapons', 'illumination', 'display'], default: 'communications' },
    { key: 'T_case', label: 'Case temp (°C)', type: 'number', default: 40, step: 5, min: -65, max: 200 },
    { key: 'duty_cycle', label: 'Duty cycle (0-1)', type: 'number', default: 1, step: 0.1, min: 0, max: 1 },
  ],
  inductive: [
    { key: 'device', label: 'Device', type: 'select', options: ['transformer', 'inductor'], default: 'transformer' },
    { key: 'T_hotspot', label: 'Hot-spot temp (°C)', type: 'number', default: 60, step: 5, min: -65, max: 300 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'MIL-SPEC', 'lower', 'commercial'], default: 'commercial' },
  ],
  relay: [
    { key: 'load', label: 'Load type', type: 'select', options: ['resistive', 'inductive', 'lamp'], default: 'resistive' },
    { key: 'contact_form', label: 'Contact form', type: 'select', options: ['SPST', 'DPST', 'SPDT', 'DPDT', '3PST', '4PST', '6PDT'], default: 'DPDT' },
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, step: 1, min: 0 },
    { key: 'application', label: 'Application', type: 'select', options: ['general_purpose', 'sensitive', 'polarized', 'vibration_resistant', 'high_speed', 'latching', 'reed', 'mercury_wetted', 'magnetic_latching', 'thermal', 'solid_state_coupled'], default: 'general_purpose' },
    { key: 'T_ambient', label: 'Ambient temp (°C)', type: 'number', default: 40, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower', 'commercial'], default: 'commercial' },
  ],
  ss_relay: [
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower', 'commercial'], default: 'commercial' },
  ],
  switch: [
    { key: 'switch_type', label: 'Switch type', type: 'select', options: ['toggle', 'pushbutton', 'sensitive', 'rotary', 'thumbwheel', 'rocker', 'slide', 'dip'], default: 'toggle' },
    { key: 'load_stress', label: 'Load stress (I/Irated)', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 0, step: 1, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  circuit_breaker: [
    { key: 'construction', label: 'Construction', type: 'select', options: ['magnetic', 'thermal', 'thermal_magnetic'], default: 'thermal_magnetic' },
    { key: 'use', label: 'Use', type: 'select', options: ['primary_power', 'control_protection', 'auxiliary'], default: 'primary_power' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  connector: [
    { key: 'connector_type', label: 'Connector type', type: 'select', options: ['circular', 'rack_panel', 'pcb_edge', 'ic_socket', 'rf_coaxial', 'fiber_optic', 'power', 'triaxial'], default: 'circular' },
    { key: 'pins', label: 'Active pins', type: 'number', default: 25, step: 1, min: 1 },
    { key: 'T_insert', label: 'Insert temp (°C)', type: 'number', default: 40, step: 5, min: -65, max: 200 },
    { key: 'matings_per_1000h', label: 'Matings per 1000 h', type: 'number', default: 0.5, step: 0.1, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  pcb: [
    { key: 'complexity', label: 'Complexity', type: 'select', options: ['single_sided', 'double_sided', 'multilayer_small', 'multilayer_medium', 'multilayer_large'], default: 'double_sided' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  connection: [
    { key: 'connection_type', label: 'Type', type: 'select', options: ['hand_solder', 'wave_solder', 'reflow_solder', 'crimp', 'weld', 'wire_wrap', 'clip_termination', 'solderless_wrap'], default: 'reflow_solder' },
  ],
  rotating: [
    { key: 'device', label: 'Device', type: 'select', options: ['motor', 'motor_ac', 'motor_dc', 'motor_ac_fractional', 'fan_blower', 'pump', 'synchro', 'elapsed_time_meter'], default: 'fan_blower' },
  ],
  meter: [
    { key: 'function', label: 'Function', type: 'select', options: ['panel_dc', 'panel_ac', 'panel_frequency', 'digital_multimeter', 'elapsed_time'], default: 'panel_dc' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  crystal: [
    { key: 'frequency_mhz', label: 'Frequency (MHz)', type: 'number', default: 10, step: 1, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower'], default: 'MIL-SPEC' },
  ],
  lamp: [
    { key: 'rated_voltage', label: 'Rated voltage (V)', type: 'number', default: 28, step: 1, min: 0 },
    { key: 'utilization', label: 'Utilization', type: 'select', options: ['continuous', 'intermittent', 'rare'], default: 'continuous' },
  ],
  filter: [
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  fuse: [],
  miscellaneous: [
    { key: 'part_type', label: 'Part type', type: 'select', options: ['surface_acoustic_wave', 'piezoelectric_crystal', 'heater', 'battery', 'centrifuge'], default: 'battery' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  custom: [
    { key: 'model', label: 'Failure model', type: 'select', options: ['exponential', 'weibull'], default: 'exponential' },
    { key: 'failure_rate', label: 'λ (FPMH, exponential)', type: 'number', default: 0.1, step: 0.01, min: 0 },
    { key: 'eta', label: 'Weibull η (hours)', type: 'number', default: 50000, step: 1000, min: 0 },
    { key: 'beta', label: 'Weibull β', type: 'number', default: 2, step: 0.1, min: 0 },
    { key: 'eval_time', label: 'Weibull eval time (hours)', type: 'number', default: 8760, step: 100, min: 0 },
  ],
  generic: [
    { key: 'failure_rate', label: 'Failure rate (FPMH)', type: 'number', default: 0.1, step: 0.01, min: 0 },
  ],
}

const CATEGORY_LABELS: Record<string, string> = {
  microcircuit: 'Microcircuit (IC)',
  hybrid_microcircuit: 'Hybrid Microcircuit',
  diode: 'Diode (LF)',
  hf_diode: 'Diode (HF/MW)',
  bjt: 'Transistor (BJT)',
  fet: 'Transistor (FET)',
  gaas_fet: 'GaAs FET / MMIC',
  unijunction: 'Unijunction Transistor',
  thyristor: 'Thyristor / SCR',
  optoelectronic: 'Optoelectronic',
  tube: 'Vacuum Tube',
  laser: 'Laser',
  resistor: 'Resistor',
  capacitor: 'Capacitor',
  inductive: 'Transformer / Inductor',
  relay: 'Relay (Mechanical)',
  ss_relay: 'Relay (Solid State)',
  switch: 'Switch',
  circuit_breaker: 'Circuit Breaker',
  connector: 'Connector',
  pcb: 'PCB / Interconnect Assembly',
  connection: 'Connection (solder etc.)',
  rotating: 'Motor / Synchro / Fan',
  meter: 'Meter',
  crystal: 'Quartz Crystal',
  lamp: 'Lamp',
  filter: 'Electronic Filter',
  fuse: 'Fuse',
  miscellaneous: 'Miscellaneous (SAW, battery...)',
  custom: 'Custom (Exp / Weibull)',
  generic: 'Generic (user λ)',
}

// Categories that don't take environment/standard (so no VITA toggle)
const NO_ENV_CATEGORIES = new Set(['custom', 'generic'])

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
    default: return CATEGORY_FIELDS
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
    default: return CATEGORY_LABELS
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
    microcircuit: 'ic', hybrid_microcircuit: 'ic',
    diode: 'diode', hf_diode: 'diode',
    bjt: 'transistor', fet: 'transistor', gaas_fet: 'transistor', unijunction: 'transistor', thyristor: 'transistor',
    optoelectronic: 'optoelectronic', laser: 'optoelectronic',
    resistor: 'resistor', capacitor: 'capacitor',
    inductive: 'inductor', rotating: 'rotating',
    relay: 'relay', ss_relay: 'relay', switch: 'switch', circuit_breaker: 'switch',
    connector: 'connector', pcb: 'pcb', crystal: 'crystal', fuse: 'fuse',
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
    resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductive', rotating: 'rotating',
    relay: 'relay', switch: 'switch', connector: 'connector', pcb: 'pcb', crystal: 'crystal', fuse: 'fuse',
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
const TEMP_PARAM_KEYS = ['temperature', 'T_ambient', 'T_junction', 'T_case', 'T_hotspot', 'T_insert']

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
  const newParams = defaultParamsForStandard(toStd, newCat)
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

/** MIL-HDBK-217F failure rate formula per part category. */
interface FormulaInfo {
  section: string
  formula: string
  factors: [string, string][]  // [symbol, description] pairs
}

const CATEGORY_FORMULAE: Record<string, FormulaInfo> = {
  microcircuit: {
    section: '5.1–5.4',
    formula: 'λp = (C1 · πT + C2 · πE) · πQ · πL',
    factors: [
      ['C1', 'Die complexity factor (gate/transistor/bit count)'],
      ['C2', 'Package complexity factor (a · Np^b)'],
      ['πT', 'Temperature factor = 0.1 · exp(−Ea/k · (1/(Tj+273) − 1/298))'],
      ['πE', 'Environment factor (Table 5-2)'],
      ['πQ', 'Quality factor (S/B/B-1/commercial)'],
      ['πL', 'Learning factor = max(1.0, 0.01 · exp(5.35 − 0.35·Y))'],
    ],
  },
  hybrid_microcircuit: {
    section: '5.5',
    formula: 'λp = [Σ(Ni · λci)] · (1 + 0.2·πE) · πF · πQ · πL',
    factors: [
      ['Σ(Ni·λci)', 'Sum of die-element failure rates × quantities'],
      ['πE', 'Environment factor'],
      ['πF', 'Function factor (circuit complexity)'],
      ['πQ', 'Quality factor'],
      ['πL', 'Learning factor'],
    ],
  },
  diode: {
    section: '6.1',
    formula: 'λp = λb · πT · πS · πC · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (diode type)'],
      ['πT', 'Temperature factor = exp(−T_coeff · (1/(Tj+273) − 1/298))'],
      ['πS', 'Electrical stress factor (Vs^2.43 for Vs > 0.3)'],
      ['πC', 'Contact construction factor (bonded=1, spring=2)'],
      ['πQ', 'Quality factor (JANTXV/JANTX/JAN/lower/plastic)'],
      ['πE', 'Environment factor (Table 6-1)'],
    ],
  },
  hf_diode: {
    section: '6.5',
    formula: 'λp = λb · πT · πA · πR · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (diode type)'],
      ['πT', 'Temperature factor = exp(−3091 · (1/(Tj+273) − 1/298))'],
      ['πA', 'Application factor (oscillator/mixer/detector/amplifier/switch)'],
      ['πR', 'Power rating factor = Prated^0.37'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  bjt: {
    section: '6.3',
    formula: 'λp = λb · πT · πA · πR · πS · πQ · πE',
    factors: [
      ['λb', 'Base failure rate = 0.00074 FPMH'],
      ['πT', 'Temperature factor = exp(−2114 · (1/(Tj+273) − 1/298))'],
      ['πA', 'Application factor (linear=1.5, switching=0.7)'],
      ['πR', 'Power rating factor = Prated^0.37'],
      ['πS', 'Voltage stress factor = 0.045 · exp(3.1 · Vs)'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  fet: {
    section: '6.4',
    formula: 'λp = λb · πT · πA · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (MOSFET=0.012, JFET=0.0045)'],
      ['πT', 'Temperature factor = exp(−1925 · (1/(Tj+273) − 1/298))'],
      ['πA', 'Application factor (switching/linear/power class)'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  gaas_fet: {
    section: '6.8–6.9',
    formula: 'λp = λb · πT · πA · πM · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (low_power=0.052, power=0.20)'],
      ['πT', 'Temperature factor = exp(−4485 · (1/(Tj+273) − 1/298))'],
      ['πA', 'Application factor (low noise/driver/power/switch)'],
      ['πM', 'Matching/device-type factor (JFET/MESFET/HEMT/pHEMT)'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  unijunction: {
    section: '6.10',
    formula: 'λp = λb · πT · πQ · πE',
    factors: [
      ['λb', 'Base failure rate = 0.0083 FPMH'],
      ['πT', 'Temperature factor = exp(−2114 · (1/(Tj+273) − 1/298))'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  thyristor: {
    section: '6.2',
    formula: 'λp = λb · πT · πR · πS · πQ · πE',
    factors: [
      ['λb', 'Base failure rate = 0.0022 FPMH'],
      ['πT', 'Temperature factor = exp(−3082 · (1/(Tj+273) − 1/298))'],
      ['πR', 'Current rating factor = Irated^0.40'],
      ['πS', 'Voltage stress factor = Vs^1.9'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  optoelectronic: {
    section: '6.11–6.13',
    formula: 'λp = λb · πT · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (device type dependent)'],
      ['πT', 'Temperature factor = exp(−2790 · (1/(Tj+273) − 1/298))'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  tube: {
    section: '7',
    formula: 'λp = λb · πU · πA · πE',
    factors: [
      ['λb', 'Base failure rate (tube type dependent)'],
      ['πU', 'Usage factor (continuous=1, pulsed=0.7)'],
      ['πA', 'Utilization/application factor'],
      ['πE', 'Environment factor'],
    ],
  },
  laser: {
    section: '8',
    formula: 'λp = λb · πT · πI · πA · πU · πE',
    factors: [
      ['λb', 'Base failure rate (laser type dependent)'],
      ['πT', 'Temperature factor (Arrhenius, Ea depends on type)'],
      ['πI', 'Mode structure factor (single/multi/Q-switched)'],
      ['πA', 'Application factor (comms/rangefinding/tracking/…)'],
      ['πU', 'Utilization / duty-cycle factor (0–1)'],
      ['πE', 'Environment factor'],
    ],
  },
  resistor: {
    section: '9',
    formula: 'λp = λb · πT · πP · πS · πR · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (style-dependent, e.g. RL=0.0023)'],
      ['πT', 'Temperature factor = exp(−Ea/k · (1/(T+273) − 1/298))'],
      ['πP', 'Power factor = Prated^0.39'],
      ['πS', 'Stress factor (film: 0.71·e^(1.1·S), WW: 0.54·e^(2.04·S))'],
      ['πR', 'Resistance factor (1.0 for R ≤ 100 kΩ … 2.5 for R > 10 MΩ)'],
      ['πQ', 'Quality factor (S/R/P/M/non-ER/commercial)'],
      ['πE', 'Environment factor'],
    ],
  },
  capacitor: {
    section: '10',
    formula: 'λp = λb · πT · πC · πV · πSR · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (style-dependent)'],
      ['πT', 'Temperature factor = exp(−Ea/k · (1/(T+273) − 1/298))'],
      ['πC', 'Capacitance factor = C^n (n depends on style)'],
      ['πV', 'Voltage stress factor = (Vs/0.6)^m + 1'],
      ['πSR', 'Series resistance factor (tantalum only)'],
      ['πQ', 'Quality factor (S/R/P/M/L/non-ER/commercial)'],
      ['πE', 'Environment factor'],
    ],
  },
  inductive: {
    section: '11',
    formula: 'λp = λb(T_HS) · πQ · πE',
    factors: [
      ['λb', 'Base failure rate = A · exp(((T_HS+273)/329)^15.6)'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  rotating: {
    section: '12',
    formula: 'λp = λb · πE',
    factors: [
      ['λb', 'Base failure rate (device type dependent)'],
      ['πE', 'Environment factor'],
    ],
  },
  relay: {
    section: '13.1',
    formula: 'λp = λb · πL · πC · πCYC · πF · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (temperature dependent)'],
      ['πL', 'Load type factor (resistive=1, inductive=2, lamp=3)'],
      ['πC', 'Contact form factor (SPST=1 … 6PDT=12.75)'],
      ['πCYC', 'Cycling rate factor = max(0.1, cycles_per_hour / 10)'],
      ['πF', 'Application/construction factor'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  ss_relay: {
    section: '13.2',
    formula: 'λp = λb · πT · πS · πQ · πE',
    factors: [
      ['λb', 'Base failure rate = 0.40 FPMH'],
      ['πT', 'Temperature factor = exp(−2790 · (1/(Tj+273) − 1/298))'],
      ['πS', 'Voltage stress factor = Vs^2 (for Vs > 0.3)'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  switch: {
    section: '14.1',
    formula: 'λp = λb · πL · πCYC · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (switch type dependent)'],
      ['πL', 'Load stress factor = exp((S/0.8)²)'],
      ['πCYC', 'Cycling rate factor'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  circuit_breaker: {
    section: '14.2',
    formula: 'λp = λb · πC · πU · πQ · πE',
    factors: [
      ['λb', 'Base failure rate = 0.020 FPMH'],
      ['πC', 'Construction factor (magnetic/thermal/thermal-magnetic)'],
      ['πU', 'Use factor (primary_power/control/auxiliary)'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  connector: {
    section: '15',
    formula: 'λp = λb · πT · πK · πP · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (connector type dependent)'],
      ['πT', 'Temperature factor = exp(−0.14/k · (1/(T+273) − 1/298))'],
      ['πK', 'Mating/unmating factor (frequency bands)'],
      ['πP', 'Active-pin count factor = exp(((N−1)/23)^0.51)'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  pcb: {
    section: '16',
    formula: 'λp = λb · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (complexity class)'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  connection: {
    section: '17',
    formula: 'λp = λb · πE',
    factors: [
      ['λb', 'Base failure rate (connection technology)'],
      ['πE', 'Environment factor'],
    ],
  },
  meter: {
    section: '18',
    formula: 'λp = λb · πF · πQ · πE',
    factors: [
      ['λb', 'Base failure rate = 0.090 FPMH'],
      ['πF', 'Meter function factor'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  crystal: {
    section: '19',
    formula: 'λp = 0.013 · f^0.23 · πQ · πE',
    factors: [
      ['f', 'Frequency in MHz'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  lamp: {
    section: '20',
    formula: 'λp = 0.074 · V^1.29 · πU · πE',
    factors: [
      ['V', 'Rated voltage (volts)'],
      ['πU', 'Utilization factor (continuous/intermittent/rare)'],
      ['πE', 'Environment factor'],
    ],
  },
  filter: {
    section: '21',
    formula: 'λp = 0.022 · πQ · πE',
    factors: [
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  fuse: {
    section: '22',
    formula: 'λp = 0.010 · πE',
    factors: [
      ['πE', 'Environment factor'],
    ],
  },
  miscellaneous: {
    section: '23',
    formula: 'λp = λb · πQ · πE',
    factors: [
      ['λb', 'Base failure rate (part type dependent)'],
      ['πQ', 'Quality factor'],
      ['πE', 'Environment factor'],
    ],
  },
  custom: {
    section: '—',
    formula: 'λp = user-specified (exponential or Weibull average)',
    factors: [
      ['λ', 'Exponential: direct failure rate in FPMH'],
      ['η, β', 'Weibull: λ = 10⁶ · (t/η)^β / t'],
    ],
  },
  generic: {
    section: '—',
    formula: 'λp = user-specified failure rate (FPMH)',
    factors: [],
  },
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
  Object.fromEntries(CATEGORY_FIELDS[category].map(f => [f.key, f.default]))

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

/**
 * One-time migration of legacy " > "-delimited group strings to SystemBlocks.
 * Returns null if no part carries an old-style group property.
 */
const migrateGroupsToBlocks = (
  parts: PredictionPart[],
  blocks: SystemBlock[],
  blockSeq: number,
): { parts: PredictionPart[]; blocks: SystemBlock[]; blockSeq: number } | null => {
  const hasGroups = parts.some(p => {
    const g = (p as { group?: unknown }).group
    return typeof g === 'string' && g.trim() !== ''
  })
  if (!hasGroups) return null

  const newBlocks = [...blocks]
  let seq = blockSeq
  const pathToId = new Map<string, string>()

  const getOrCreate = (path: string): string => {
    const existing = pathToId.get(path)
    if (existing) return existing
    const segs = path.split(' > ')
    const name = segs[segs.length - 1].trim() || 'Block'
    const parentPath = segs.slice(0, -1).join(' > ')
    const parentId = parentPath ? getOrCreate(parentPath) : null
    seq += 1
    const id = `b${seq}`
    newBlocks.push({ id, name, parentId })
    pathToId.set(path, id)
    return id
  }

  const newParts = parts.map(p => {
    const { group, ...rest } = p as PredictionPart & { group?: string }
    if (typeof group === 'string' && group.trim()) {
      return { ...rest, parentId: getOrCreate(group.trim()) }
    }
    return rest
  })

  return { parts: newParts, blocks: newBlocks, blockSeq: seq }
}

/** Per-part VITA override cycle: inherit (null) -> on (true) -> off (false). */
const nextVita = (v: boolean | null | undefined): boolean | null =>
  v == null ? true : v ? false : null

const vitaLabel = (v: boolean | null | undefined, global: boolean) =>
  v == null ? (global ? 'Global (on)' : 'Global (off)') : v ? 'On' : 'Off'

export default function Prediction() {
  const [state, setState, folios] = useFolioState<PredictionState>('prediction', INITIAL_STATE)
  const { environment, vitaGlobal, missionHours, parts } = state
  const blocks = state.blocks ?? []
  const blockSeq = state.blockSeq ?? 0
  const result = state.result ?? null

  // One-time migration: legacy persisted state may have " > "-delimited group
  // strings on parts (and no blocks array). Convert to SystemBlocks once.
  useEffect(() => {
    setState(s => {
      const curBlocks = s.blocks ?? []
      const curSeq = s.blockSeq ?? 0
      const migrated = curBlocks.length === 0
        ? migrateGroupsToBlocks(s.parts, curBlocks, curSeq)
        : null
      if (migrated) return { ...s, ...migrated }
      if (s.blocks == null || s.blockSeq == null) {
        return { ...s, blocks: curBlocks, blockSeq: curSeq }
      }
      return s
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const [libraryOpen, setLibraryOpen] = useState(true)

  // Mission Profile
  const [missionPhases, setMissionPhases] = useState<MissionPhaseInput[]>([])
  const [missionResult, setMissionResult] = useState<MissionProfileResponse | null>(null)
  const [missionOpen, setMissionOpen] = useState(false)
  const [missionProfileName, setMissionProfileName] = useState('Custom Mission')
  const [presetProfiles, setPresetProfiles] = useState<Record<string, { name: string; phases: MissionPhaseInput[] }>>({})

  useEffect(() => {
    getMissionProfiles().then(setPresetProfiles).catch(() => {})
    getDeratingStandards().then(setDeratingStandards).catch(() => {})
  }, [])

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
    const cleaned: Record<string, string | number> = {}
    for (const f of (getCategoryFields(standard)[category] ?? [])) {
      const v = params[f.key]
      if (f.type === 'number') {
        const num = typeof v === 'number' ? v : parseFloat(v)
        if (isNaN(num)) { setError(`Invalid value for ${f.label}.`); return }
        cleaned[f.key] = num
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
      apply_vita: null,
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

  const removePart = (idx: number) =>
    patchInputs({ parts: parts.filter((_, i) => i !== idx) })

  const updatePartQty = (idx: number, qty: string) => {
    const n = parseInt(qty, 10)
    patchInputs({
      parts: parts.map((p, i) => i === idx
        ? { ...p, quantity: isNaN(n) || n < 1 ? 1 : n } : p),
    })
  }

  const cyclePartVita = (idx: number) =>
    patchInputs({
      parts: parts.map((p, i) => i === idx
        ? { ...p, apply_vita: nextVita(p.apply_vita) } : p),
    })

  /** Update a specific field on a part in the parts list (clears results). */
  const updatePartField = (idx: number, field: string, value: unknown) =>
    patchInputs({
      parts: parts.map((p, i) => i === idx ? { ...p, [field]: value } : p),
    })

  /** Update a parameter within a part's params bag (clears results). */
  const updatePartParam = (idx: number, key: string, value: string | number) =>
    patchInputs({
      parts: parts.map((p, i) =>
        i === idx ? { ...p, params: { ...p.params, [key]: value } } : p),
    })

  const selectedPart = selectedPartIdx != null ? parts[selectedPartIdx] : null
  const selectedResult = selectedPartIdx != null ? result?.results[selectedPartIdx] : null

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
      })
      setMissionResult(res)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Mission profile error.')
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
        let nextParts = slice.parts as PredictionPart[]
        let nextBlocks: SystemBlock[] = Array.isArray(slice.blocks) ? slice.blocks as SystemBlock[] : []
        let nextSeq: number = typeof slice.blockSeq === 'number' ? slice.blockSeq : 0
        // Older exports used " > "-delimited group strings — migrate to blocks
        const migrated = migrateGroupsToBlocks(nextParts, nextBlocks, nextSeq)
        if (migrated) {
          nextParts = migrated.parts
          nextBlocks = migrated.blocks
          nextSeq = migrated.blockSeq
        }
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

  // --- plots ---

  const reliabilityPlot = (() => {
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
  })()

  // Contribution pie chart data: aggregate by top-level system block
  // (or the part's own name if it sits at root level)
  const contributionPie = (() => {
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
  })()

  const missionR = (() => {
    if (!result) return null
    const tm = parseFloat(missionHours)
    if (isNaN(tm) || tm <= 0) return null
    return Math.exp(-result.total_failure_rate * tm / 1e6)
  })()

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      <FolioBar api={folios} />
      <div className="flex flex-1 min-h-0">
      {/* Left panel */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
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
          </div>
          {standard === 'MIL-HDBK-217F' && (
            <>
              <label className="flex items-center justify-between gap-2 rounded border border-purple-200 bg-purple-50 px-3 py-2 cursor-pointer">
                <span>
                  <span className="text-xs font-semibold text-purple-800 block">ANSI/VITA 51.1 supplement</span>
                  <span className="text-[10px] text-purple-500">Apply COTS adjustments globally</span>
                </span>
                <input type="checkbox" checked={vitaGlobal}
                  onChange={e => patchInputs({ vitaGlobal: e.target.checked })}
                  className="rounded text-purple-600 w-4 h-4" />
              </label>
              <p className="text-[10px] text-gray-400 px-1">
                Each part can override the global setting from the parts list (Global / On / Off).
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
                  <p className="font-semibold text-teal-800">Mission: {missionResult.profile_name}</p>
                  <p>System λ = {missionResult.system_failure_rate.toFixed(6)} FPMH</p>
                  <p>MTBF = {missionResult.system_mtbf?.toLocaleString() ?? '—'} hrs</p>
                  <p>R(mission) = {missionResult.mission_reliability.toFixed(6)}</p>
                  <p className="text-gray-500 mt-0.5">Duration: {missionResult.total_duration.toLocaleString()} hrs</p>
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
          <h3 className="text-xs font-semibold text-gray-800 mb-2">Add part</h3>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                <select value={category} onChange={e => changeCategory(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  {Object.keys(getCategoryFields(standard)).map(c =>
                    <option key={c} value={c}>{getCategoryLabels(standard)[c] ?? c}</option>)}
                </select>
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
            {standard === 'MIL-HDBK-217F' && !NO_ENV_CATEGORIES.has(category) && (
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
                <label className="block text-xs font-medium text-gray-700 mb-1">{f.label}</label>
                {f.type === 'select' ? (
                  <select value={String(params[f.key])}
                    onChange={e => setParams(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                    {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <NumberField value={String(params[f.key])}
                    onChange={v => setParams(p => ({ ...p, [f.key]: v }))}
                    step={f.step} min={f.min} max={f.max}
                    className="w-full !py-1.5" />
                )}
              </div>
            ))}
            <button onClick={addPart}
              className="flex items-center justify-center gap-1 border border-blue-600 text-blue-600 hover:bg-blue-50 text-xs font-medium py-1.5 rounded transition-colors">
              <Plus size={12} /> Add to parts list
            </button>
          </div>
        </div>

        <hr className="border-gray-200" />

        {/* System block editor */}
        <div>
          <h3 className="text-xs font-semibold text-gray-800 mb-2">Add System Block</h3>
          <div className="flex flex-col gap-2">
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
          </div>
        </div>

        <hr className="border-gray-200" />

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"
            title="Operating time used to convert the system failure rate into a mission reliability R(t) = exp(−λ·t). Also marks the mission line on the reliability plot.">
            Mission time (hours)
          </label>
          <input type="number" min={0} step={100} value={missionHours} onChange={e => patch({ missionHours: e.target.value })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        <button onClick={run} disabled={loading}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors">
          <Play size={14} />
          {loading ? 'Computing...' : 'Predict Failure Rate'}
        </button>
      </div>

      {/* Main content + optional detail panel */}
      <div className="flex-1 flex min-w-0">
      <div className={`flex-1 overflow-y-auto p-6 min-w-0 ${selectedPart ? 'pr-0' : ''}`}>
        {/* Component library palette — drag items into the parts list (#12).
            Only components valid for the active standard are shown, organized
            into logical groups (#4, #5). */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setLibraryOpen(o => !o)}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-blue-700 transition-colors"
              title={libraryOpen ? 'Collapse the component library' : 'Expand the component library'}>
              {libraryOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
              Component Library <span className="text-gray-400 font-normal">— {STANDARD_INFO[standard].name}</span>
            </button>
            {libraryOpen && <span className="text-[10px] text-gray-400">Drag a component onto the parts list or into a system block</span>}
          </div>
          {libraryOpen && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex flex-col gap-3">
            {paletteGroupsFor(standard).map(({ group, items }) => (
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
              <p className="text-xs mt-1">Drag a component from the library above, add parts or a system block from the left panel, or import a parts list (JSON)</p>
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
                    <th className="px-3 py-2 text-left font-medium text-gray-600">π factors</th>
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
                    const r = result?.results[i]
                    const incompatible = !!r?.incompatible
                    return (
                      <tr key={`p${i}`}
                        onClick={() => setSelectedPartIdx(selectedPartIdx === i ? null : i)}
                        className={`border-t group cursor-pointer ${
                          incompatible
                            ? 'border-l-2 border-l-red-400 border-t-red-100 bg-red-50 hover:bg-red-100/70'
                            : `border-gray-100 hover:bg-blue-50/50 ${selectedPartIdx === i ? 'bg-blue-50' : ''}`
                        }`}>
                        <td className="py-1.5 font-medium" style={{ paddingLeft: 12 + row.depth * 20 }}>
                          <span className="inline-flex items-center gap-1.5">
                            <CategoryIcon category={p.category} />
                            <span>{p.name || `${getCategoryLabels(standard)[p.category] ?? p.category} ${i + 1}`}</span>
                            {incompatible && (
                              <span title={r?.error || 'Not supported by the selected standard'}>
                                <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />
                              </span>
                            )}
                            {p.notes != null && p.notes.trim() !== '' && (
                              <span title={p.notes}>
                                <StickyNote size={11} className="text-amber-400 flex-shrink-0" />
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">{getCategoryLabels(standard)[p.category] ?? p.category}</td>
                        <td className="px-1 py-1 text-right" onClick={e => e.stopPropagation()}>
                          <input type="number" min={1} step={1} value={p.quantity}
                            onChange={e => updatePartQty(i, e.target.value)}
                            className="w-14 text-xs text-right border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 py-0.5 focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-500">
                          {Number(p.params.multiplier ?? 1)}
                        </td>
                        {standard === 'MIL-HDBK-217F' && (
                          <td className="px-3 py-1.5 text-center">
                            {NO_ENV_CATEGORIES.has(p.category) ? (
                              <span className="text-gray-300">n/a</span>
                            ) : (
                              <button onClick={e => { e.stopPropagation(); cyclePartVita(i) }}
                                title="Click to cycle: Global / On / Off"
                                className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                                  p.apply_vita == null
                                    ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                    : p.apply_vita
                                      ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                      : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                }`}>
                                {vitaLabel(p.apply_vita, vitaGlobal)}
                              </button>
                            )}
                          </td>
                        )}
                        <td className="px-2 py-1.5 text-center">
                          {NO_ENV_CATEGORIES.has(p.category) ? (
                            <span className="text-[10px] text-gray-300">n/a</span>
                          ) : (
                            <span className={`text-[10px] font-mono ${p.environment ? 'text-green-700 font-semibold' : 'text-gray-400'}`}
                              title={p.environment ? `Override: ${p.environment}` : `Inherited: ${resolveEnvironment(p) || environment}`}>
                              {p.environment || resolveEnvironment(p) || environment}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{incompatible ? <span className="text-red-300">—</span> : r ? r.failure_rate.toFixed(5) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{incompatible ? <span className="text-red-300">—</span> : r ? r.total_failure_rate.toFixed(5) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{incompatible ? <span className="text-red-300">—</span> : r ? `${(r.contribution * 100).toFixed(1)}%` : '—'}</td>
                        <td className="px-3 py-1.5 font-mono text-[10px]">
                          {incompatible
                            ? <span className="text-red-600">{r?.error || 'Not supported by the selected standard'}</span>
                            : <span className="text-gray-500">{r ? Object.entries(r.pi_factors).map(([k, v]) => `${k}=${v}`).join('  ') : '—'}</span>}
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <button onClick={e => { e.stopPropagation(); removePart(i); if (selectedPartIdx === i) setSelectedPartIdx(null); else if (selectedPartIdx != null && selectedPartIdx > i) setSelectedPartIdx(selectedPartIdx - 1) }}
                            className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
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
                          onClick={() => setSelectedPartIdx(idx)}
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
          {standard === 'MIL-HDBK-217F' && ' The ANSI/VITA 51.1 supplement applies representative COTS quality-factor adjustments.'}
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
            <button onClick={() => setSelectedPartIdx(null)}
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
                onChange={e => updatePartField(selectedPartIdx, 'name', e.target.value || undefined)}
                placeholder="e.g. U1, R10"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>

            {/* Quantity + Multiplier + Parent block */}
            <div className="grid grid-cols-3 gap-2">
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
            {standard === 'MIL-HDBK-217F' && !NO_ENV_CATEGORIES.has(selectedPart.category) && (
              <div>
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
              <div>
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

            {/* Formula card (MIL-HDBK-217F only) */}
            {standard === 'MIL-HDBK-217F' && CATEGORY_FORMULAE[selectedPart.category] && (() => {
              const fi = CATEGORY_FORMULAE[selectedPart.category]
              return (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                      MIL-HDBK-217F §{fi.section}
                    </span>
                  </div>
                  <div className="font-mono text-sm font-semibold text-gray-800 bg-white border border-gray-200 rounded px-2.5 py-1.5 text-center select-all">
                    {fi.formula}
                  </div>
                  <table className="w-full text-[11px]">
                    <tbody>
                      {fi.factors.map(([sym, desc]) => (
                        <tr key={sym} className="border-t border-gray-100 first:border-t-0">
                          <td className="py-0.5 pr-2 font-mono font-semibold text-indigo-600 whitespace-nowrap align-top">{sym}</td>
                          <td className="py-0.5 text-gray-600">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}

            {/* Category-specific parameters */}
            <h4 className="text-xs font-semibold text-gray-700">{STANDARD_INFO[standard].name} Parameters</h4>
            {(getCategoryFields(standard)[selectedPart.category] ?? []).map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">{f.label}</label>
                {f.type === 'select' ? (
                  <select value={String(selectedPart.params[f.key] ?? f.default)}
                    onChange={e => updatePartParam(selectedPartIdx, f.key, e.target.value)}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                    {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <NumberField
                    value={String(selectedPart.params[f.key] ?? f.default)}
                    onChange={v => {
                      const num = parseFloat(v)
                      updatePartParam(selectedPartIdx, f.key, isNaN(num) ? (v as unknown as number) : num)
                    }}
                    step={f.step} min={f.min} max={f.max}
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
                  Computed Pi Factors
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
                        return (
                          <tr key={k} className="border-t border-gray-100">
                            <td className={`px-2 py-1 font-mono ${selectedResult.vita ? 'text-purple-700' : 'text-gray-700'}`}>{k}</td>
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
                {showBase && (
                  <p className="text-[10px] text-gray-400 px-0.5">
                    Highlighted cells differ from the base MIL-HDBK-217F value due to the VITA 51.1 quality-factor adjustment.
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
