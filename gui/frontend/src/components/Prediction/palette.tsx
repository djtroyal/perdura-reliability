import {
  Cpu, MemoryStick, CircuitBoard, Zap, Triangle, Lightbulb, Battery,
  Magnet, ToggleRight, ToggleLeft, Plug, Cable, Fan, Diamond, Filter,
  RectangleHorizontal, Radio, Box, Disc, Gauge, Shield,
  MonitorSpeaker, Activity, Cog, Droplet, Wind, Wrench, Gauge as GaugeIcon,
  CircleDot, Settings, Waves, Thermometer,
} from 'lucide-react'

/**
 * Icon-based component-library palette.
 *
 * Each entry maps a recognizable piece-part type to one of a standard's
 * prediction categories so a dropped component is immediately valid for
 * prediction (its params come from that category's `defaultParams`).
 *
 * Items are tagged with a `group` (logical grouping for display) and stored
 * per prediction standard, so the GUI only shows components relevant to the
 * currently-selected standard.
 */
export interface PaletteItem {
  id: string
  label: string
  category: string
  group: string
  Icon: typeof Cpu
  color: string
  paramOverrides?: Record<string, string | number>
}

// --- MIL-HDBK-217F ---------------------------------------------------------
const MIL_ITEMS: PaletteItem[] = [
  { id: 'ic-digital', label: 'Digital IC', category: 'microcircuit', group: 'Microcircuits', Icon: Cpu, color: 'text-indigo-500' },
  { id: 'ic-memory', label: 'Memory', category: 'microcircuit', group: 'Microcircuits', Icon: MemoryStick, color: 'text-indigo-400',
    paramOverrides: { device_type: 'memory', complexity: 1000000 } },
  { id: 'ic-micro', label: 'Microprocessor', category: 'microcircuit', group: 'Microcircuits', Icon: Cpu, color: 'text-violet-500',
    paramOverrides: { device_type: 'microprocessor' } },
  { id: 'ic-hybrid', label: 'Hybrid IC', category: 'hybrid_microcircuit', group: 'Microcircuits', Icon: CircuitBoard, color: 'text-indigo-600' },
  { id: 'diode', label: 'Diode', category: 'diode', group: 'Discrete Semiconductors', Icon: Triangle, color: 'text-rose-500' },
  { id: 'hf-diode', label: 'HF/MW Diode', category: 'hf_diode', group: 'Discrete Semiconductors', Icon: Triangle, color: 'text-rose-400' },
  { id: 'led', label: 'LED', category: 'optoelectronic', group: 'Discrete Semiconductors', Icon: Lightbulb, color: 'text-yellow-500' },
  { id: 'bjt', label: 'Transistor (BJT)', category: 'bjt', group: 'Discrete Semiconductors', Icon: Radio, color: 'text-emerald-500' },
  { id: 'fet', label: 'MOSFET', category: 'fet', group: 'Discrete Semiconductors', Icon: Radio, color: 'text-teal-500',
    paramOverrides: { application: 'power_5_50W' } },
  { id: 'gaas-fet', label: 'GaAs FET', category: 'gaas_fet', group: 'Discrete Semiconductors', Icon: Radio, color: 'text-teal-400' },
  { id: 'thyristor', label: 'Thyristor / SCR', category: 'thyristor', group: 'Discrete Semiconductors', Icon: Zap, color: 'text-amber-500' },
  { id: 'tube', label: 'Vacuum Tube', category: 'tube', group: 'Discrete Semiconductors', Icon: MonitorSpeaker, color: 'text-orange-600' },
  { id: 'laser', label: 'Laser', category: 'laser', group: 'Discrete Semiconductors', Icon: Activity, color: 'text-red-400' },
  { id: 'resistor', label: 'Resistor', category: 'resistor', group: 'Passives', Icon: RectangleHorizontal, color: 'text-orange-500' },
  { id: 'capacitor', label: 'Capacitor', category: 'capacitor', group: 'Passives', Icon: Battery, color: 'text-sky-500' },
  { id: 'inductor', label: 'Transformer / Inductor', category: 'inductive', group: 'Passives', Icon: Magnet, color: 'text-purple-500' },
  { id: 'crystal', label: 'Crystal', category: 'crystal', group: 'Passives', Icon: Diamond, color: 'text-fuchsia-500' },
  { id: 'filter', label: 'Filter', category: 'filter', group: 'Passives', Icon: Filter, color: 'text-violet-500' },
  { id: 'relay', label: 'Relay', category: 'relay', group: 'Electromechanical', Icon: ToggleRight, color: 'text-cyan-500' },
  { id: 'ss-relay', label: 'Solid State Relay', category: 'ss_relay', group: 'Electromechanical', Icon: ToggleRight, color: 'text-cyan-400' },
  { id: 'switch', label: 'Switch', category: 'switch', group: 'Electromechanical', Icon: ToggleLeft, color: 'text-blue-500' },
  { id: 'breaker', label: 'Circuit Breaker', category: 'circuit_breaker', group: 'Electromechanical', Icon: Shield, color: 'text-blue-600' },
  { id: 'rotating', label: 'Motor / Fan', category: 'rotating', group: 'Electromechanical', Icon: Fan, color: 'text-green-500' },
  { id: 'lamp', label: 'Lamp', category: 'lamp', group: 'Electromechanical', Icon: Lightbulb, color: 'text-amber-400' },
  { id: 'connector', label: 'Connector', category: 'connector', group: 'Interconnect', Icon: Plug, color: 'text-lime-600' },
  { id: 'connection', label: 'Solder / Connection', category: 'connection', group: 'Interconnect', Icon: Cable, color: 'text-stone-500' },
  { id: 'pcb', label: 'PCB', category: 'pcb', group: 'Interconnect', Icon: CircuitBoard, color: 'text-emerald-600' },
  { id: 'meter', label: 'Meter', category: 'meter', group: 'Other', Icon: Gauge, color: 'text-slate-500' },
  { id: 'fuse', label: 'Fuse', category: 'fuse', group: 'Other', Icon: Zap, color: 'text-red-500' },
  { id: 'misc', label: 'Misc (SAW/Battery)', category: 'miscellaneous', group: 'Other', Icon: Disc, color: 'text-gray-500' },
  { id: 'custom', label: 'Custom λ', category: 'custom', group: 'Other', Icon: Box, color: 'text-gray-400' },
]

// --- Telcordia SR-332 ------------------------------------------------------
const TELCORDIA_ITEMS: PaletteItem[] = [
  { id: 'tc-ic-digital', label: 'IC — Digital', category: 'ic_digital', group: 'Microcircuits', Icon: Cpu, color: 'text-indigo-500' },
  { id: 'tc-ic-linear', label: 'IC — Linear', category: 'ic_linear', group: 'Microcircuits', Icon: Cpu, color: 'text-indigo-400' },
  { id: 'tc-ic-memory', label: 'IC — Memory', category: 'ic_memory', group: 'Microcircuits', Icon: MemoryStick, color: 'text-violet-500' },
  { id: 'tc-ic-micro', label: 'IC — Microprocessor', category: 'ic_microprocessor', group: 'Microcircuits', Icon: Cpu, color: 'text-violet-600' },
  { id: 'tc-diode', label: 'Diode', category: 'diode', group: 'Discrete Semiconductors', Icon: Triangle, color: 'text-rose-500' },
  { id: 'tc-bjt', label: 'Transistor (BJT)', category: 'transistor_bjt', group: 'Discrete Semiconductors', Icon: Radio, color: 'text-emerald-500' },
  { id: 'tc-fet', label: 'Transistor (FET)', category: 'transistor_fet', group: 'Discrete Semiconductors', Icon: Radio, color: 'text-teal-500' },
  { id: 'tc-resistor', label: 'Resistor', category: 'resistor', group: 'Passives', Icon: RectangleHorizontal, color: 'text-orange-500' },
  { id: 'tc-capacitor', label: 'Capacitor', category: 'capacitor', group: 'Passives', Icon: Battery, color: 'text-sky-500' },
  { id: 'tc-inductor', label: 'Inductor', category: 'inductor', group: 'Passives', Icon: Magnet, color: 'text-purple-500' },
  { id: 'tc-transformer', label: 'Transformer', category: 'transformer', group: 'Passives', Icon: Magnet, color: 'text-purple-600' },
  { id: 'tc-crystal', label: 'Crystal', category: 'crystal', group: 'Passives', Icon: Diamond, color: 'text-fuchsia-500' },
  { id: 'tc-relay', label: 'Relay', category: 'relay', group: 'Electromechanical', Icon: ToggleRight, color: 'text-cyan-500' },
  { id: 'tc-switch', label: 'Switch', category: 'switch', group: 'Electromechanical', Icon: ToggleLeft, color: 'text-blue-500' },
  { id: 'tc-connector', label: 'Connector', category: 'connector', group: 'Interconnect', Icon: Plug, color: 'text-lime-600' },
  { id: 'tc-pcb', label: 'PCB', category: 'pcb', group: 'Interconnect', Icon: CircuitBoard, color: 'text-emerald-600' },
  { id: 'tc-fuse', label: 'Fuse', category: 'fuse', group: 'Other', Icon: Zap, color: 'text-red-500' },
]

// --- 217Plus ---------------------------------------------------------------
const PLUS217_ITEMS: PaletteItem[] = [
  { id: 'p-ic', label: 'Microcircuit', category: 'microcircuit', group: 'Microcircuits', Icon: Cpu, color: 'text-indigo-500' },
  { id: 'p-discrete', label: 'Discrete Semiconductor', category: 'discrete_semiconductor', group: 'Discrete Semiconductors', Icon: Radio, color: 'text-emerald-500' },
  { id: 'p-resistor', label: 'Resistor', category: 'resistor', group: 'Passives', Icon: RectangleHorizontal, color: 'text-orange-500' },
  { id: 'p-capacitor', label: 'Capacitor', category: 'capacitor', group: 'Passives', Icon: Battery, color: 'text-sky-500' },
  { id: 'p-inductor', label: 'Inductor', category: 'inductor', group: 'Passives', Icon: Magnet, color: 'text-purple-500' },
  { id: 'p-crystal', label: 'Crystal', category: 'crystal', group: 'Passives', Icon: Diamond, color: 'text-fuchsia-500' },
  { id: 'p-relay', label: 'Relay', category: 'relay', group: 'Electromechanical', Icon: ToggleRight, color: 'text-cyan-500' },
  { id: 'p-switch', label: 'Switch', category: 'switch', group: 'Electromechanical', Icon: ToggleLeft, color: 'text-blue-500' },
  { id: 'p-rotating', label: 'Rotating Device', category: 'rotating', group: 'Electromechanical', Icon: Fan, color: 'text-green-500' },
  { id: 'p-connector', label: 'Connector', category: 'connector', group: 'Interconnect', Icon: Plug, color: 'text-lime-600' },
  { id: 'p-pcb', label: 'PCB', category: 'pcb', group: 'Interconnect', Icon: CircuitBoard, color: 'text-emerald-600' },
  { id: 'p-fuse', label: 'Fuse', category: 'fuse', group: 'Other', Icon: Zap, color: 'text-red-500' },
]

// --- FIDES Guide 2022 ------------------------------------------------------
const FIDES_ITEMS: PaletteItem[] = [
  { id: 'f-ic', label: 'IC', category: 'ic', group: 'Semiconductors', Icon: Cpu, color: 'text-indigo-500' },
  { id: 'f-discrete', label: 'Discrete', category: 'discrete', group: 'Semiconductors', Icon: Radio, color: 'text-emerald-500' },
  { id: 'f-resistor', label: 'Resistor', category: 'passive_resistor', group: 'Passives', Icon: RectangleHorizontal, color: 'text-orange-500' },
  { id: 'f-capacitor', label: 'Capacitor', category: 'passive_capacitor', group: 'Passives', Icon: Battery, color: 'text-sky-500' },
  { id: 'f-inductor', label: 'Inductor', category: 'passive_inductor', group: 'Passives', Icon: Magnet, color: 'text-purple-500' },
  { id: 'f-crystal', label: 'Crystal', category: 'crystal', group: 'Passives', Icon: Diamond, color: 'text-fuchsia-500' },
  { id: 'f-relay', label: 'Relay', category: 'relay', group: 'Electromechanical', Icon: ToggleRight, color: 'text-cyan-500' },
  { id: 'f-switch', label: 'Switch', category: 'switch', group: 'Electromechanical', Icon: ToggleLeft, color: 'text-blue-500' },
  { id: 'f-connector', label: 'Connector', category: 'connector', group: 'Interconnect', Icon: Plug, color: 'text-lime-600' },
  { id: 'f-pcb', label: 'PCB', category: 'pcb', group: 'Interconnect', Icon: CircuitBoard, color: 'text-emerald-600' },
]

// --- NSWC-98/LE1 (mechanical) ----------------------------------------------
const NSWC_ITEMS: PaletteItem[] = [
  { id: 'n-bearing', label: 'Bearing', category: 'bearing', group: 'Rotating & Drive', Icon: CircleDot, color: 'text-slate-500' },
  { id: 'n-gear', label: 'Gear', category: 'gear', group: 'Rotating & Drive', Icon: Settings, color: 'text-stone-500' },
  { id: 'n-coupling', label: 'Coupling', category: 'coupling', group: 'Rotating & Drive', Icon: Cog, color: 'text-zinc-500' },
  { id: 'n-belt', label: 'Belt / Chain', category: 'belt_chain', group: 'Rotating & Drive', Icon: Cog, color: 'text-amber-600' },
  { id: 'n-motor', label: 'Electric Motor', category: 'electric_motor', group: 'Rotating & Drive', Icon: Fan, color: 'text-green-500' },
  { id: 'n-brake', label: 'Brake / Clutch', category: 'brake_clutch', group: 'Rotating & Drive', Icon: Disc, color: 'text-red-500' },
  { id: 'n-pump', label: 'Pump', category: 'pump', group: 'Fluid', Icon: Droplet, color: 'text-blue-500' },
  { id: 'n-valve', label: 'Valve', category: 'valve', group: 'Fluid', Icon: Wrench, color: 'text-cyan-600' },
  { id: 'n-actuator', label: 'Actuator', category: 'actuator', group: 'Fluid', Icon: Wrench, color: 'text-teal-600' },
  { id: 'n-filter', label: 'Filter', category: 'filter_mech', group: 'Fluid', Icon: Filter, color: 'text-violet-500' },
  { id: 'n-line', label: 'Hydraulic Line', category: 'hydraulic_line', group: 'Fluid', Icon: Waves, color: 'text-sky-600' },
  { id: 'n-spring', label: 'Spring', category: 'spring', group: 'Static & Sealing', Icon: Activity, color: 'text-orange-500' },
  { id: 'n-seal', label: 'Seal', category: 'seal', group: 'Static & Sealing', Icon: CircleDot, color: 'text-rose-500' },
]

// --- EPRD-2014 (empirical electronic) --------------------------------------
const EPRD_ITEMS: PaletteItem[] = [
  { id: 'e-ic', label: 'Microcircuit', category: 'eprd_microcircuit', group: 'Microcircuits', Icon: Cpu, color: 'text-indigo-500' },
  { id: 'e-opto', label: 'Optoelectronic', category: 'eprd_optoelectronic', group: 'Discrete Semiconductors', Icon: Lightbulb, color: 'text-yellow-500' },
  { id: 'e-diode', label: 'Diode', category: 'eprd_diode', group: 'Discrete Semiconductors', Icon: Triangle, color: 'text-rose-500' },
  { id: 'e-transistor', label: 'Transistor', category: 'eprd_transistor', group: 'Discrete Semiconductors', Icon: Radio, color: 'text-emerald-500' },
  { id: 'e-resistor', label: 'Resistor', category: 'eprd_resistor', group: 'Passives', Icon: RectangleHorizontal, color: 'text-orange-500' },
  { id: 'e-capacitor', label: 'Capacitor', category: 'eprd_capacitor', group: 'Passives', Icon: Battery, color: 'text-sky-500' },
  { id: 'e-inductor', label: 'Inductor', category: 'eprd_inductor', group: 'Passives', Icon: Magnet, color: 'text-purple-500' },
  { id: 'e-relay', label: 'Relay', category: 'eprd_relay', group: 'Electromechanical', Icon: ToggleRight, color: 'text-cyan-500' },
  { id: 'e-switch', label: 'Switch', category: 'eprd_switch', group: 'Electromechanical', Icon: ToggleLeft, color: 'text-blue-500' },
  { id: 'e-connector', label: 'Connector', category: 'eprd_connector', group: 'Interconnect', Icon: Plug, color: 'text-lime-600' },
]

// --- NPRD-2023 (empirical nonelectronic) -----------------------------------
const NPRD_ITEMS: PaletteItem[] = [
  { id: 'np-motor', label: 'Electric Motor', category: 'nprd_motor', group: 'Rotating Machinery', Icon: Fan, color: 'text-green-500' },
  { id: 'np-fan', label: 'Fan / Blower', category: 'nprd_fan', group: 'Rotating Machinery', Icon: Wind, color: 'text-emerald-500' },
  { id: 'np-bearing', label: 'Bearing', category: 'nprd_bearing', group: 'Rotating Machinery', Icon: CircleDot, color: 'text-slate-500' },
  { id: 'np-gear', label: 'Gear', category: 'nprd_gear', group: 'Rotating Machinery', Icon: Settings, color: 'text-stone-500' },
  { id: 'np-pump', label: 'Pump', category: 'nprd_pump', group: 'Fluid Handling', Icon: Droplet, color: 'text-blue-500' },
  { id: 'np-valve', label: 'Valve', category: 'nprd_valve', group: 'Fluid Handling', Icon: Wrench, color: 'text-cyan-600' },
  { id: 'np-actuator', label: 'Actuator', category: 'nprd_actuator', group: 'Fluid Handling', Icon: Wrench, color: 'text-teal-600' },
  { id: 'np-filter', label: 'Filter', category: 'nprd_filter', group: 'Fluid Handling', Icon: Filter, color: 'text-violet-500' },
  { id: 'np-relay', label: 'Relay', category: 'nprd_relay', group: 'Electromechanical', Icon: ToggleRight, color: 'text-cyan-500' },
  { id: 'np-switch', label: 'Switch', category: 'nprd_switch', group: 'Electromechanical', Icon: ToggleLeft, color: 'text-blue-500' },
  { id: 'np-sensor', label: 'Sensor', category: 'nprd_sensor', group: 'Electromechanical', Icon: GaugeIcon, color: 'text-slate-600' },
  { id: 'np-connector', label: 'Connector', category: 'nprd_connector', group: 'Interconnect', Icon: Plug, color: 'text-lime-600' },
  { id: 'np-battery', label: 'Battery', category: 'nprd_battery', group: 'Power & Misc', Icon: Battery, color: 'text-sky-600' },
  { id: 'np-generic', label: 'Generic Part', category: 'nprd_generic', group: 'Power & Misc', Icon: Thermometer, color: 'text-gray-500' },
]

/** Palette items grouped by prediction standard. */
export const PALETTE_BY_STANDARD: Record<string, PaletteItem[]> = {
  'MIL-HDBK-217F': MIL_ITEMS,
  'Telcordia': TELCORDIA_ITEMS,
  '217Plus': PLUS217_ITEMS,
  'FIDES': FIDES_ITEMS,
  'NSWC': NSWC_ITEMS,
  'EPRD-2014': EPRD_ITEMS,
  'NPRD-2023': NPRD_ITEMS,
}

/** Preferred display order for groups (any unlisted group sorts to the end). */
export const PALETTE_GROUP_ORDER = [
  'Microcircuits', 'Semiconductors', 'Discrete Semiconductors', 'Passives',
  'Electromechanical', 'Interconnect',
  'Rotating Machinery', 'Rotating & Drive', 'Fluid', 'Fluid Handling',
  'Static & Sealing', 'Power & Misc', 'Other',
]

/** Return palette items for a standard, grouped and ordered for display. */
export function paletteGroupsFor(standard: string): { group: string; items: PaletteItem[] }[] {
  const items = PALETTE_BY_STANDARD[standard] ?? MIL_ITEMS
  const byGroup = new Map<string, PaletteItem[]>()
  for (const item of items) {
    if (!byGroup.has(item.group)) byGroup.set(item.group, [])
    byGroup.get(item.group)!.push(item)
  }
  const order = (g: string) => {
    const i = PALETTE_GROUP_ORDER.indexOf(g)
    return i === -1 ? PALETTE_GROUP_ORDER.length : i
  }
  return [...byGroup.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([group, items]) => ({ group, items }))
}

/** Backward-compatible flat list (MIL-HDBK-217F default). */
export const PALETTE_ITEMS: PaletteItem[] = MIL_ITEMS

/** MIME-like key used on the drag dataTransfer for palette drops. */
export const PALETTE_DND_TYPE = 'application/x-perdura-palette'
