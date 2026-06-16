import {
  Cpu, MemoryStick, CircuitBoard, Zap, Triangle, Lightbulb, Battery,
  Magnet, ToggleRight, ToggleLeft, Plug, Cable, Fan, Diamond, Filter,
  RectangleHorizontal, Radio, Box, Waves, Disc, Gauge, Shield,
  MonitorSpeaker, Activity,
} from 'lucide-react'

/**
 * Icon-based component-library palette.
 *
 * Each entry maps a recognizable piece-part type to one of the module's
 * existing prediction categories so a dropped component is immediately valid
 * for prediction (its params come from that category's `defaultParams`).
 */
export interface PaletteItem {
  id: string
  label: string
  category: string
  Icon: typeof Cpu
  color: string
  paramOverrides?: Record<string, string | number>
}

export const PALETTE_ITEMS: PaletteItem[] = [
  { id: 'ic-digital', label: 'Digital IC', category: 'microcircuit', Icon: Cpu, color: 'text-indigo-500' },
  { id: 'ic-memory', label: 'Memory', category: 'microcircuit', Icon: MemoryStick, color: 'text-indigo-400',
    paramOverrides: { device_type: 'memory', complexity: 1000000 } },
  { id: 'ic-micro', label: 'Microprocessor', category: 'microcircuit', Icon: Cpu, color: 'text-violet-500',
    paramOverrides: { device_type: 'microprocessor' } },
  { id: 'ic-hybrid', label: 'Hybrid IC', category: 'hybrid_microcircuit', Icon: CircuitBoard, color: 'text-indigo-600' },
  { id: 'resistor', label: 'Resistor', category: 'resistor', Icon: RectangleHorizontal, color: 'text-orange-500' },
  { id: 'capacitor', label: 'Capacitor', category: 'capacitor', Icon: Battery, color: 'text-sky-500' },
  { id: 'diode', label: 'Diode', category: 'diode', Icon: Triangle, color: 'text-rose-500' },
  { id: 'hf-diode', label: 'HF/MW Diode', category: 'hf_diode', Icon: Triangle, color: 'text-rose-400' },
  { id: 'led', label: 'LED', category: 'optoelectronic', Icon: Lightbulb, color: 'text-yellow-500' },
  { id: 'bjt', label: 'Transistor (BJT)', category: 'bjt', Icon: Radio, color: 'text-emerald-500' },
  { id: 'fet', label: 'MOSFET', category: 'fet', Icon: Radio, color: 'text-teal-500',
    paramOverrides: { application: 'power_5_50W' } },
  { id: 'gaas-fet', label: 'GaAs FET', category: 'gaas_fet', Icon: Radio, color: 'text-teal-400' },
  { id: 'thyristor', label: 'Thyristor / SCR', category: 'thyristor', Icon: Zap, color: 'text-amber-500' },
  { id: 'tube', label: 'Vacuum Tube', category: 'tube', Icon: MonitorSpeaker, color: 'text-orange-600' },
  { id: 'laser', label: 'Laser', category: 'laser', Icon: Activity, color: 'text-red-400' },
  { id: 'inductor', label: 'Transformer / Inductor', category: 'inductive', Icon: Magnet, color: 'text-purple-500' },
  { id: 'relay', label: 'Relay', category: 'relay', Icon: ToggleRight, color: 'text-cyan-500' },
  { id: 'ss-relay', label: 'Solid State Relay', category: 'ss_relay', Icon: ToggleRight, color: 'text-cyan-400' },
  { id: 'switch', label: 'Switch', category: 'switch', Icon: ToggleLeft, color: 'text-blue-500' },
  { id: 'breaker', label: 'Circuit Breaker', category: 'circuit_breaker', Icon: Shield, color: 'text-blue-600' },
  { id: 'connector', label: 'Connector', category: 'connector', Icon: Plug, color: 'text-lime-600' },
  { id: 'connection', label: 'Solder / Connection', category: 'connection', Icon: Cable, color: 'text-stone-500' },
  { id: 'pcb', label: 'PCB', category: 'pcb', Icon: CircuitBoard, color: 'text-emerald-600' },
  { id: 'rotating', label: 'Motor / Fan', category: 'rotating', Icon: Fan, color: 'text-green-500' },
  { id: 'crystal', label: 'Crystal', category: 'crystal', Icon: Diamond, color: 'text-fuchsia-500' },
  { id: 'lamp', label: 'Lamp', category: 'lamp', Icon: Lightbulb, color: 'text-amber-400' },
  { id: 'filter', label: 'Filter', category: 'filter', Icon: Filter, color: 'text-violet-500' },
  { id: 'fuse', label: 'Fuse', category: 'fuse', Icon: Zap, color: 'text-red-500' },
  { id: 'meter', label: 'Meter', category: 'meter', Icon: Gauge, color: 'text-slate-500' },
  { id: 'misc', label: 'Misc (SAW/Battery)', category: 'miscellaneous', Icon: Disc, color: 'text-gray-500' },
  { id: 'custom', label: 'Custom λ', category: 'custom', Icon: Box, color: 'text-gray-400' },
]

/** MIME-like key used on the drag dataTransfer for palette drops. */
export const PALETTE_DND_TYPE = 'application/x-perdura-palette'
