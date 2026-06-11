import { useState, useRef, Fragment } from 'react'
import Plot from 'react-plotly.js'
import { Play, Plus, Trash2, Upload, Download } from 'lucide-react'
import {
  predictFailureRate, PredictionPart, PredictionResponse,
} from '../../api/client'
import { useModuleState } from '../../store/project'

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
}

const CATEGORY_FIELDS: Record<string, Field[]> = {
  microcircuit: [
    { key: 'device_type', label: 'Device type', type: 'select', options: ['digital', 'linear', 'microprocessor'], default: 'digital' },
    { key: 'technology', label: 'Technology', type: 'select', options: ['mos', 'bipolar'], default: 'mos' },
    { key: 'complexity', label: 'Gates / transistors / bits', type: 'number', default: 1000 },
    { key: 'pins', label: 'Pins', type: 'number', default: 16 },
    { key: 'package', label: 'Package', type: 'select', options: ['nonhermetic', 'hermetic_dip', 'glass_dip', 'flatpack', 'can'], default: 'nonhermetic' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'B', 'B-1', 'commercial'], default: 'commercial' },
    { key: 'years_in_production', label: 'Years in production', type: 'number', default: 2 },
  ],
  diode: [
    { key: 'diode_type', label: 'Diode type', type: 'select', options: ['general_purpose', 'switching', 'power_rectifier', 'fast_recovery_rectifier', 'schottky', 'zener_regulator', 'voltage_reference', 'transient_suppressor'], default: 'general_purpose' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50 },
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5 },
    { key: 'contact', label: 'Contact construction', type: 'select', options: ['bonded', 'spring'], default: 'bonded' },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  bjt: [
    { key: 'application', label: 'Application', type: 'select', options: ['switching', 'linear'], default: 'switching' },
    { key: 'rated_power', label: 'Rated power (W)', type: 'number', default: 0.5 },
    { key: 'voltage_stress', label: 'Voltage stress (VCE/VCEO)', type: 'number', default: 0.5 },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  fet: [
    { key: 'fet_type', label: 'FET type', type: 'select', options: ['mosfet', 'jfet'], default: 'mosfet' },
    { key: 'application', label: 'Application', type: 'select', options: ['switching', 'linear', 'power_2_5W', 'power_5_50W', 'power_50_250W', 'power_gt_250W'], default: 'switching' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  resistor: [
    { key: 'style', label: 'Style', type: 'select', options: ['film', 'composition'], default: 'film' },
    { key: 'resistance', label: 'Resistance (Ω)', type: 'number', default: 10000 },
    { key: 'power_stress', label: 'Power stress (P/Prated)', type: 'number', default: 0.5 },
    { key: 'T_ambient', label: 'Ambient temp (°C)', type: 'number', default: 40 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'non-ER', 'commercial'], default: 'commercial' },
  ],
  capacitor: [
    { key: 'style', label: 'Style', type: 'select', options: ['ceramic', 'tantalum_solid', 'aluminum_electrolytic', 'plastic_film'], default: 'ceramic' },
    { key: 'capacitance', label: 'Capacitance (µF)', type: 'number', default: 0.1 },
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5 },
    { key: 'T_ambient', label: 'Ambient temp (°C)', type: 'number', default: 40 },
    { key: 'circuit_resistance', label: 'Circuit resistance (Ω/V, tantalum)', type: 'number', default: 1.0 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'L', 'non-ER', 'commercial'], default: 'commercial' },
  ],
  thyristor: [
    { key: 'rated_current', label: 'Rated current (A)', type: 'number', default: 1 },
    { key: 'voltage_stress', label: 'Voltage stress (V/Vrated)', type: 'number', default: 0.5 },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  optoelectronic: [
    { key: 'device', label: 'Device', type: 'select', options: ['led', 'photodiode', 'phototransistor', 'optocoupler', 'alphanumeric_display'], default: 'led' },
    { key: 'T_junction', label: 'Junction temp (°C)', type: 'number', default: 50 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['JANTXV', 'JANTX', 'JAN', 'lower', 'plastic'], default: 'plastic' },
  ],
  inductive: [
    { key: 'device', label: 'Device', type: 'select', options: ['transformer', 'inductor'], default: 'transformer' },
    { key: 'T_hotspot', label: 'Hot-spot temp (°C)', type: 'number', default: 60 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['S', 'R', 'P', 'M', 'MIL-SPEC', 'lower', 'commercial'], default: 'commercial' },
  ],
  relay: [
    { key: 'load', label: 'Load type', type: 'select', options: ['resistive', 'inductive', 'lamp'], default: 'resistive' },
    { key: 'cycles_per_hour', label: 'Cycles per hour', type: 'number', default: 1 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower', 'commercial'], default: 'commercial' },
  ],
  switch: [
    { key: 'switch_type', label: 'Switch type', type: 'select', options: ['toggle', 'pushbutton', 'sensitive', 'rotary'], default: 'toggle' },
    { key: 'load_stress', label: 'Load stress (I/Irated)', type: 'number', default: 0.5 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  connector: [
    { key: 'pins', label: 'Active pins', type: 'number', default: 25 },
    { key: 'T_insert', label: 'Insert temp (°C)', type: 'number', default: 40 },
    { key: 'matings_per_1000h', label: 'Matings per 1000 h', type: 'number', default: 0.5 },
  ],
  connection: [
    { key: 'connection_type', label: 'Type', type: 'select', options: ['hand_solder', 'wave_solder', 'reflow_solder', 'crimp', 'weld', 'wire_wrap'], default: 'reflow_solder' },
  ],
  rotating: [
    { key: 'device', label: 'Device', type: 'select', options: ['motor', 'fan_blower', 'pump'], default: 'fan_blower' },
  ],
  crystal: [
    { key: 'frequency_mhz', label: 'Frequency (MHz)', type: 'number', default: 10 },
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'lower'], default: 'MIL-SPEC' },
  ],
  lamp: [
    { key: 'rated_voltage', label: 'Rated voltage (V)', type: 'number', default: 28 },
    { key: 'utilization', label: 'Utilization', type: 'select', options: ['continuous', 'intermittent', 'rare'], default: 'continuous' },
  ],
  filter: [
    { key: 'quality', label: 'Quality', type: 'select', options: ['MIL-SPEC', 'commercial'], default: 'commercial' },
  ],
  fuse: [],
  custom: [
    { key: 'model', label: 'Failure model', type: 'select', options: ['exponential', 'weibull'], default: 'exponential' },
    { key: 'failure_rate', label: 'λ (FPMH, exponential)', type: 'number', default: 0.1 },
    { key: 'eta', label: 'Weibull η (hours)', type: 'number', default: 50000 },
    { key: 'beta', label: 'Weibull β', type: 'number', default: 2 },
    { key: 'eval_time', label: 'Weibull eval time (hours)', type: 'number', default: 8760 },
  ],
  generic: [
    { key: 'failure_rate', label: 'Failure rate (FPMH)', type: 'number', default: 0.1 },
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

const defaultParams = (category: string): Record<string, string | number> =>
  Object.fromEntries(CATEGORY_FIELDS[category].map(f => [f.key, f.default]))

interface PredictionState {
  environment: string
  vitaGlobal: boolean
  missionHours: string
  parts: PredictionPart[]
  result?: PredictionResponse | null
}

const INITIAL_STATE: PredictionState = {
  environment: 'GB',
  vitaGlobal: false,
  missionHours: '8760',
  parts: [],
}

/** Per-part VITA override cycle: inherit (null) -> on (true) -> off (false). */
const nextVita = (v: boolean | null | undefined): boolean | null =>
  v == null ? true : v ? false : null

const vitaLabel = (v: boolean | null | undefined, global: boolean) =>
  v == null ? (global ? 'Global (on)' : 'Global (off)') : v ? 'On' : 'Off'

export default function Prediction() {
  const [state, setState] = useModuleState<PredictionState>('prediction', INITIAL_STATE)
  const { environment, vitaGlobal, missionHours, parts } = state
  const result = state.result ?? null

  // Part editor (transient)
  const [category, setCategory] = useState('microcircuit')
  const [partName, setPartName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [editorVita, setEditorVita] = useState<'inherit' | 'on' | 'off'>('inherit')
  const [editorMultiplier, setEditorMultiplier] = useState('1')
  const [editorGroup, setEditorGroup] = useState('')
  const [params, setParams] = useState<Record<string, string | number>>(
    defaultParams('microcircuit'))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
        group: editorGroup.trim() || undefined,
      }],
    })
    setPartName('')
  }

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

  const run = async () => {
    if (parts.length === 0) { setError('Add at least one part.'); return }
    setError(null)
    setLoading(true)
    try {
      const res = await predictFailureRate({ environment, vita_global: vitaGlobal, parts })
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
        prediction: { environment, vitaGlobal, missionHours, parts },
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
        patchInputs({
          environment: typeof slice.environment === 'string' ? slice.environment : environment,
          vitaGlobal: typeof slice.vitaGlobal === 'boolean' ? slice.vitaGlobal : vitaGlobal,
          missionHours: typeof slice.missionHours === 'string' ? slice.missionHours : missionHours,
          parts: slice.parts as PredictionPart[],
        })
      } catch {
        setError('File is not valid JSON.')
      }
    }
    reader.readAsText(file)
  }

  // Grouped display order: each group renders as a section with a
  // subtotal header; ungrouped parts follow as standalone rows.
  const partDisplayOrder = (() => {
    const sections: { key: string; group: string | null; indices: number[] }[] = []
    const groupIdx = new Map<string, number>()
    const ungrouped: number[] = []
    parts.forEach((p, i) => {
      const g = p.group?.trim()
      if (g) {
        if (!groupIdx.has(g)) {
          groupIdx.set(g, sections.length)
          sections.push({ key: `g:${g}`, group: g, indices: [] })
        }
        sections[groupIdx.get(g)!].indices.push(i)
      } else {
        ungrouped.push(i)
      }
    })
    if (ungrouped.length > 0) {
      sections.push({ key: 'ungrouped', group: null, indices: ungrouped })
    }
    return sections
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

  const missionR = (() => {
    if (!result) return null
    const tm = parseFloat(missionHours)
    if (isNaN(tm) || tm <= 0) return null
    return Math.exp(-result.total_failure_rate * tm / 1e6)
  })()

  return (
    <div className="flex h-[calc(100vh-57px)]">
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Environment</label>
            <select value={environment} onChange={e => patchInputs({ environment: e.target.value })}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {ENVIRONMENTS.map(env => <option key={env.code} value={env.code}>{env.label}</option>)}
            </select>
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
                <input type="number" min={1} value={quantity}
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Multiplier <span className="text-gray-400">(e.g. mode ratio)</span>
                </label>
                <input type="number" step="any" min={0} value={editorMultiplier}
                  onChange={e => setEditorMultiplier(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Group <span className="text-gray-400">(optional)</span>
                </label>
                <input type="text" value={editorGroup} list="part-groups"
                  onChange={e => setEditorGroup(e.target.value)}
                  placeholder="e.g. PSU"
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <datalist id="part-groups">
                  {[...new Set(parts.map(p => p.group?.trim()).filter(Boolean))].map(g =>
                    <option key={g} value={g} />)}
                </datalist>
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
                  <input type="number" step="any" value={String(params[f.key])}
                    onChange={e => setParams(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
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

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Mission time (hours)</label>
          <input type="number" value={missionHours} onChange={e => patch({ missionHours: e.target.value })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        <button onClick={run} disabled={loading}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors">
          <Play size={14} />
          {loading ? 'Computing...' : 'Predict Failure Rate'}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
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

          {parts.length === 0 ? (
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center text-gray-400">
              <p className="text-sm font-medium">No parts yet</p>
              <p className="text-xs mt-1">Add parts from the left panel, or import a parts list (JSON)</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Part</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Category</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 w-16">Qty</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 w-14">Mult</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-600">VITA 51.1</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">λ each (FPMH)</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">λ total (FPMH)</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Contribution</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">π factors</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {partDisplayOrder.map(section => (
                    <Fragment key={section.key}>
                      {section.group && (
                        <tr className="border-t border-gray-200 bg-gray-50/70">
                          <td colSpan={6} className="px-3 py-1.5 font-semibold text-gray-700">
                            ⌸ {section.group}
                            <span className="text-gray-400 font-normal"> ({section.indices.length} part{section.indices.length === 1 ? '' : 's'})</span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">
                            {result ? section.indices.reduce(
                              (s, i) => s + (result.results[i]?.total_failure_rate ?? 0), 0).toFixed(5) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">
                            {result ? `${(section.indices.reduce(
                              (s, i) => s + (result.results[i]?.contribution ?? 0), 0) * 100).toFixed(1)}%` : '—'}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      )}
                      {section.indices.map(i => {
                        const p = parts[i]
                        const r = result?.results[i]
                        return (
                          <tr key={i} className="border-t border-gray-100 group">
                            <td className={`px-3 py-1.5 font-medium ${section.group ? 'pl-7' : ''}`}>
                              {p.name || `${CATEGORY_LABELS[p.category]} ${i + 1}`}
                            </td>
                            <td className="px-3 py-1.5 text-gray-500">{CATEGORY_LABELS[p.category] ?? p.category}</td>
                            <td className="px-1 py-1 text-right">
                              <input type="number" min={1} value={p.quantity}
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
                                <button onClick={() => cyclePartVita(i)}
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
                            <td className="px-3 py-1.5 text-right font-mono">{r ? r.failure_rate.toFixed(5) : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{r ? r.total_failure_rate.toFixed(5) : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{r ? `${(r.contribution * 100).toFixed(1)}%` : '—'}</td>
                            <td className="px-3 py-1.5 text-gray-500 font-mono text-[10px]">
                              {r ? Object.entries(r.pi_factors).map(([k, v]) => `${k}=${v}`).join('  ') : '—'}
                            </td>
                            <td className="px-1 py-1.5 text-center">
                              <button onClick={() => removePart(i)}
                                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {result ? (
          <>
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

            {/* Reliability curve */}
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
          </>
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
    </div>
  )
}
