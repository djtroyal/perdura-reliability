import { useState, useRef, useEffect } from 'react'
import Plot from 'react-plotly.js'
import {
  Play, Plus, Trash2, Upload, Download, X, ChevronRight, ChevronDown,
  FolderOpen, Folder, Box, Cpu, Triangle, CircuitBoard, Zap, Lightbulb,
  Battery, Magnet, ToggleRight, ToggleLeft, Plug, Cable, Fan, Diamond,
  Filter, RectangleHorizontal, StickyNote,
} from 'lucide-react'
import {
  predictFailureRate, PredictionPart, PredictionResponse,
} from '../../api/client'
import { useFolioState } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import ExportResultsButton from '../shared/ExportResultsButton'
import NumberField from '../shared/NumberField'
import { PALETTE_ITEMS, PALETTE_DND_TYPE, PaletteItem } from './palette'

// Icon + accent color per component category, shown in the Parts List.
const CATEGORY_ICONS: Record<string, { Icon: typeof Cpu; color: string }> = {
  microcircuit: { Icon: Cpu, color: 'text-indigo-500' },
  diode: { Icon: Triangle, color: 'text-rose-500' },
  bjt: { Icon: CircuitBoard, color: 'text-emerald-500' },
  fet: { Icon: CircuitBoard, color: 'text-teal-500' },
  thyristor: { Icon: Zap, color: 'text-amber-500' },
  optoelectronic: { Icon: Lightbulb, color: 'text-yellow-500' },
  resistor: { Icon: RectangleHorizontal, color: 'text-orange-500' },
  capacitor: { Icon: Battery, color: 'text-sky-500' },
  inductive: { Icon: Magnet, color: 'text-purple-500' },
  relay: { Icon: ToggleRight, color: 'text-cyan-500' },
  switch: { Icon: ToggleLeft, color: 'text-blue-500' },
  connector: { Icon: Plug, color: 'text-lime-600' },
  connection: { Icon: Cable, color: 'text-stone-500' },
  rotating: { Icon: Fan, color: 'text-green-500' },
  crystal: { Icon: Diamond, color: 'text-fuchsia-500' },
  lamp: { Icon: Lightbulb, color: 'text-amber-400' },
  filter: { Icon: Filter, color: 'text-violet-500' },
  fuse: { Icon: Zap, color: 'text-red-500' },
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
    { key: 'device_type', label: 'Device type', type: 'select', options: ['digital', 'linear', 'microprocessor'], default: 'digital' },
    { key: 'technology', label: 'Technology', type: 'select', options: ['mos', 'bipolar'], default: 'mos' },
    { key: 'complexity', label: 'Gates / transistors / bits', type: 'number', default: 1000, step: 100, min: 1 },
    { key: 'pins', label: 'Pins', type: 'number', default: 16, step: 1, min: 1 },
    { key: 'package', label: 'Package', type: 'select', options: ['nonhermetic', 'hermetic_dip', 'glass_dip', 'flatpack', 'can'], default: 'nonhermetic' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50, step: 5, min: -65, max: 200 },
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
  resistor: [
    { key: 'style', label: 'Style', type: 'select', options: ['film', 'composition'], default: 'film' },
    { key: 'resistance', label: 'Resistance (Ω)', type: 'number', default: 10000, step: 100, min: 0 },
    { key: 'power_stress', label: 'Power stress (P/Prated)', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'T_ambient', label: 'Ambient temp (°C)', type: 'number', default: 40, step: 5, min: -65, max: 200 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'non-ER', 'commercial'], default: 'commercial' },
  ],
  capacitor: [
    { key: 'style', label: 'Style', type: 'select', options: ['ceramic', 'tantalum_solid', 'aluminum_electrolytic', 'plastic_film'], default: 'ceramic' },
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
  inductive: [
    { key: 'device', label: 'Device', type: 'select', options: ['transformer', 'inductor'], default: 'transformer' },
    { key: 'T_hotspot', label: 'Hot-spot temp (°C)', type: 'number', default: 60, step: 5, min: -65, max: 300 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'MIL-SPEC', 'lower', 'commercial'], default: 'commercial' },
  ],
  relay: [
    { key: 'load', label: 'Load type', type: 'select', options: ['resistive', 'inductive', 'lamp'], default: 'resistive' },
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1, step: 1, min: 0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower', 'commercial'], default: 'commercial' },
  ],
  switch: [
    { key: 'switch_type', label: 'Switch type', type: 'select', options: ['toggle', 'pushbutton', 'sensitive', 'rotary'], default: 'toggle' },
    { key: 'load_stress', label: 'Load stress (I/Irated)', type: 'number', default: 0.5, step: 0.05, min: 0, max: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  connector: [
    { key: 'pins', label: 'Active pins', type: 'number', default: 25, step: 1, min: 1 },
    { key: 'T_insert', label: 'Insert temp (°C)', type: 'number', default: 40, step: 5, min: -65, max: 200 },
    { key: 'matings_per_1000h', label: 'Matings per 1000 h', type: 'number', default: 0.5, step: 0.1, min: 0 },
  ],
  connection: [
    { key: 'connection_type', label: 'Type', type: 'select', options: ['hand_solder', 'wave_solder', 'reflow_solder', 'crimp', 'weld', 'wire_wrap'], default: 'reflow_solder' },
  ],
  rotating: [
    { key: 'device', label: 'Device', type: 'select', options: ['motor', 'fan_blower', 'pump'], default: 'fan_blower' },
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
  diode: 'Diode',
  bjt: 'Transistor (BJT)',
  fet: 'Transistor (FET)',
  thyristor: 'Thyristor / SCR',
  optoelectronic: 'Optoelectronic',
  resistor: 'Resistor',
  capacitor: 'Capacitor',
  inductive: 'Transformer / Inductor',
  relay: 'Relay',
  switch: 'Switch',
  connector: 'Connector',
  connection: 'Connection (solder etc.)',
  rotating: 'Motor / Fan / Pump',
  crystal: 'Quartz Crystal',
  lamp: 'Lamp',
  filter: 'Electronic Filter',
  fuse: 'Fuse',
  custom: 'Custom (Exp / Weibull)',
  generic: 'Generic (user λ)',
}

// Categories that don't take environment/standard (so no VITA toggle)
const NO_ENV_CATEGORIES = new Set(['custom', 'generic'])

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

  const patch = (p: Partial<PredictionState>) => setState(s => ({ ...s, ...p }))
  // Any change to inputs invalidates the previous run
  const patchInputs = (p: Partial<PredictionState>) =>
    setState(s => ({ ...s, ...p, result: null }))

  const changeCategory = (c: string) => {
    setCategory(c)
    setParams(defaultParams(c))
  }

  const addPart = () => {
    const qty = parseInt(quantity, 10)
    if (isNaN(qty) || qty < 1) { setError('Quantity must be a positive integer.'); return }
    const mult = parseFloat(editorMultiplier)
    if (isNaN(mult) || mult <= 0) { setError('Multiplier must be > 0.'); return }
    const cleaned: Record<string, string | number> = {}
    for (const f of CATEGORY_FIELDS[category]) {
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
    const item = PALETTE_ITEMS.find(p => p.id === id)
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
      // Strip frontend-only fields before sending to the API;
      // resolve per-part environment from block hierarchy.
      const apiParts = parts.map(({ parentId: _parentId, ...rest }) => ({
        ...rest,
        environment: resolveEnvironment({ ...rest, parentId: _parentId }) || undefined,
      }))
      const res = await predictFailureRate({ environment, vita_global: vitaGlobal, parts: apiParts })
      patch({ result: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running prediction.')
    } finally {
      setLoading(false)
    }
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
        ?? (parts[i]?.name || `${CATEGORY_LABELS[parts[i]?.category] ?? parts[i]?.category} ${i + 1}`)
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
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-semibold text-gray-700">MIL-HDBK-217F Notice 2</p>
            <p className="text-[10px] text-gray-500">Base prediction method (part stress)</p>
          </div>
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
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1"
              title="MIL-HDBK-217F operating environment. Sets the πE environmental stress factor applied to every part (unless a part or block overrides it). Ground Benign is the mildest; Cannon Launch the harshest.">
              Environment
            </label>
            <select value={environment} onChange={e => patchInputs({ environment: e.target.value })}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {ENVIRONMENTS.map(env => <option key={env.code} value={env.code}>{env.label}</option>)}
            </select>
            {ENV_DESCRIPTIONS[environment] && (
              <p className="text-[10px] text-gray-500 mt-1 leading-snug px-0.5">{ENV_DESCRIPTIONS[environment]}</p>
            )}
          </div>
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
                  {Object.keys(CATEGORY_FIELDS).map(c =>
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
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
            {!NO_ENV_CATEGORIES.has(category) && (
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
            {!NO_ENV_CATEGORIES.has(category) && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Environment override</label>
                <select value={editorEnv}
                  onChange={e => setEditorEnv(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option value="">Use block/global ({environment})</option>
                  {ENVIRONMENTS.map(env => <option key={env.code} value={env.code}>{env.label}</option>)}
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
            {CATEGORY_FIELDS[category].map(f => (
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
        {/* Component library palette — drag items into the parts list (#12) */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Component Library</h3>
            <span className="text-[10px] text-gray-400">Drag a component onto the parts list or into a system block</span>
          </div>
          <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
            {PALETTE_ITEMS.map(item => {
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
                    <th className="px-3 py-2 text-center font-medium text-gray-600">VITA 51.1</th>
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
                    return (
                      <tr key={`p${i}`}
                        onClick={() => setSelectedPartIdx(selectedPartIdx === i ? null : i)}
                        className={`border-t border-gray-100 group cursor-pointer hover:bg-blue-50/50 ${selectedPartIdx === i ? 'bg-blue-50' : ''}`}>
                        <td className="py-1.5 font-medium" style={{ paddingLeft: 12 + row.depth * 20 }}>
                          <span className="inline-flex items-center gap-1.5">
                            <CategoryIcon category={p.category} />
                            <span>{p.name || `${CATEGORY_LABELS[p.category]} ${i + 1}`}</span>
                            {p.notes != null && p.notes.trim() !== '' && (
                              <span title={p.notes}>
                                <StickyNote size={11} className="text-amber-400 flex-shrink-0" />
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">{CATEGORY_LABELS[p.category] ?? p.category}</td>
                        <td className="px-1 py-1 text-right" onClick={e => e.stopPropagation()}>
                          <input type="number" min={1} step={1} value={p.quantity}
                            onChange={e => updatePartQty(i, e.target.value)}
                            className="w-14 text-xs text-right border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 py-0.5 focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-500">
                          {Number(p.params.multiplier ?? 1)}
                        </td>
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
                        <td className="px-3 py-1.5 text-right font-mono">{r ? r.failure_rate.toFixed(5) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{r ? r.total_failure_rate.toFixed(5) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{r ? `${(r.contribution * 100).toFixed(1)}%` : '—'}</td>
                        <td className="px-3 py-1.5 text-gray-500 font-mono text-[10px]">
                          {r ? Object.entries(r.pi_factors).map(([k, v]) => `${k}=${v}`).join('  ') : '—'}
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
                  MIL-HDBK-217F{result.vita_global ? ' + VITA 51.1' : ''}
                  <br />{result.environment}
                </p>
              </div>
            </div>

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
          Base prediction per MIL-HDBK-217F Notice 2 part stress method. The ANSI/VITA 51.1
          supplement applies representative COTS quality-factor adjustments — verify against
          the licensed standard for formal deliverables.
        </p>
      </div>

      {/* Part detail / edit panel */}
      {selectedPart && selectedPartIdx != null && (
        <div className="w-96 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1">
              <ChevronRight size={14} className="text-gray-400" />
              {selectedPart.name || `${CATEGORY_LABELS[selectedPart.category]} ${selectedPartIdx + 1}`}
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
              <p className="text-xs font-semibold text-gray-800">{CATEGORY_LABELS[selectedPart.category] ?? selectedPart.category}</p>
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

            {/* VITA override */}
            {!NO_ENV_CATEGORIES.has(selectedPart.category) && (
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
            {!NO_ENV_CATEGORIES.has(selectedPart.category) && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Environment override</label>
                <select
                  value={selectedPart.environment || ''}
                  onChange={e => updatePartField(selectedPartIdx, 'environment', e.target.value || null)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option value="">Use block/global ({resolveEnvironment({ ...selectedPart, environment: null }) || environment})</option>
                  {ENVIRONMENTS.map(env => <option key={env.code} value={env.code}>{env.label}</option>)}
                </select>
              </div>
            )}

            <hr className="border-gray-200" />

            {/* Category-specific parameters */}
            <h4 className="text-xs font-semibold text-gray-700">MIL-HDBK-217F Parameters</h4>
            {CATEGORY_FIELDS[selectedPart.category]?.map(f => (
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
    </div>
  )
}
