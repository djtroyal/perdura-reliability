import {
  Cpu, MemoryStick, CircuitBoard, Zap, Triangle, Lightbulb, Battery,
  Magnet, ToggleRight, ToggleLeft, Plug, Cable, Fan, Diamond, Filter,
  RectangleHorizontal, Radio, Box,
} from 'lucide-react'

/**
 * Icon-based component-library palette (#12).
 *
 * Each entry maps a recognizable piece-part type to one of the module's
 * existing prediction categories so a dropped component is immediately valid
 * for prediction (its params come from that category's `defaultParams`).
 * `paramOverrides` tweaks a couple of category defaults so e.g. a "Power
 * MOSFET" lands with a power application rather than a small-signal one.
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
    paramOverrides: { complexity: 1000000 } },
  { id: 'ic-micro', label: 'Microprocessor', category: 'microcircuit', Icon: Cpu, color: 'text-violet-500',
    paramOverrides: { device_type: 'microprocessor' } },
  { id: 'resistor', label: 'Resistor', category: 'resistor', Icon: RectangleHorizontal, color: 'text-orange-500' },
  { id: 'capacitor', label: 'Capacitor', category: 'capacitor', Icon: Battery, color: 'text-sky-500' },
  { id: 'diode', label: 'Diode', category: 'diode', Icon: Triangle, color: 'text-rose-500' },
  { id: 'led', label: 'LED', category: 'optoelectronic', Icon: Lightbulb, color: 'text-yellow-500' },
  { id: 'bjt', label: 'Transistor (BJT)', category: 'bjt', Icon: Radio, color: 'text-emerald-500' },
  { id: 'fet', label: 'MOSFET', category: 'fet', Icon: Radio, color: 'text-teal-500',
    paramOverrides: { application: 'power_5_50W' } },
  { id: 'thyristor', label: 'Thyristor / SCR', category: 'thyristor', Icon: Zap, color: 'text-amber-500' },
  { id: 'inductor', label: 'Transformer / Inductor', category: 'inductive', Icon: Magnet, color: 'text-purple-500' },
  { id: 'relay', label: 'Relay', category: 'relay', Icon: ToggleRight, color: 'text-cyan-500' },
  { id: 'switch', label: 'Switch', category: 'switch', Icon: ToggleLeft, color: 'text-blue-500' },
  { id: 'connector', label: 'Connector', category: 'connector', Icon: Plug, color: 'text-lime-600' },
  { id: 'connection', label: 'Solder / Connection', category: 'connection', Icon: Cable, color: 'text-stone-500' },
  { id: 'rotating', label: 'Motor / Fan', category: 'rotating', Icon: Fan, color: 'text-green-500' },
  { id: 'crystal', label: 'Crystal', category: 'crystal', Icon: Diamond, color: 'text-fuchsia-500' },
  { id: 'lamp', label: 'Lamp', category: 'lamp', Icon: Lightbulb, color: 'text-amber-400' },
  { id: 'filter', label: 'Filter', category: 'filter', Icon: Filter, color: 'text-violet-500' },
  { id: 'fuse', label: 'Fuse', category: 'fuse', Icon: Zap, color: 'text-red-500' },
  { id: 'pcb', label: 'PCB (generic)', category: 'connection', Icon: CircuitBoard, color: 'text-emerald-600',
    paramOverrides: { connection_type: 'reflow_solder' } },
  { id: 'custom', label: 'Custom λ', category: 'custom', Icon: Box, color: 'text-gray-400' },
]

/** MIME-like key used on the drag dataTransfer for palette drops. */
export const PALETTE_DND_TYPE = 'application/x-perdura-palette'
