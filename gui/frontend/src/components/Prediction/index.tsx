import { useState } from 'react'
import Plot from 'react-plotly.js'
import { Play, Plus, Trash2 } from 'lucide-react'
import {
  predictFailureRate, PredictionPart, PredictionResponse,
} from '../../api/client'

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
  generic: [
    { key: 'failure_rate', label: 'Failure rate (FPMH)', type: 'number', default: 0.1 },
  ],
}

const CATEGORY_LABELS: Record<string, string> = {
  microcircuit: 'Microcircuit (IC)',
  diode: 'Diode',
  bjt: 'Transistor (BJT)',
  fet: 'Transistor (FET)',
  resistor: 'Resistor',
  capacitor: 'Capacitor',
  generic: 'Generic (user λ)',
}

const defaultParams = (category: string): Record<string, string | number> =>
  Object.fromEntries(CATEGORY_FIELDS[category].map(f => [f.key, f.default]))

export default function Prediction() {
  const [environment, setEnvironment] = useState('GB')
  const [standard, setStandard] = useState('MIL-HDBK-217F')
  const [parts, setParts] = useState<PredictionPart[]>([])

  // Part editor state
  const [category, setCategory] = useState('microcircuit')
  const [partName, setPartName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [params, setParams] = useState<Record<string, string | number>>(
    defaultParams('microcircuit'))

  const [missionHours, setMissionHours] = useState('8760')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PredictionResponse | null>(null)

  const changeCategory = (c: string) => {
    setCategory(c)
    setParams(defaultParams(c))
  }

  const addPart = () => {
    const qty = parseInt(quantity, 10)
    if (isNaN(qty) || qty < 1) { setError('Quantity must be a positive integer.'); return }
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
    setError(null)
    setParts(prev => [...prev, {
      category,
      name: partName.trim() || undefined,
      quantity: qty,
      params: cleaned,
    }])
    setPartName('')
  }

  const removePart = (idx: number) =>
    setParts(prev => prev.filter((_, i) => i !== idx))

  const run = async () => {
    if (parts.length === 0) { setError('Add at least one part.'); return }
    setError(null)
    setLoading(true)
    try {
      const res = await predictFailureRate({ environment, standard, parts })
      setResult(res)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running prediction.')
    } finally {
      setLoading(false)
    }
  }

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
        <div className="grid grid-cols-1 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Prediction standard</label>
            <select value={standard} onChange={e => setStandard(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="MIL-HDBK-217F">MIL-HDBK-217F Notice 2</option>
              <option value="VITA-51.1">ANSI/VITA 51.1 (COTS adjustments)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Environment</label>
            <select value={environment} onChange={e => setEnvironment(e.target.value)}
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

        {/* Parts list */}
        <div>
          <h3 className="text-xs font-semibold text-gray-800 mb-2">
            Parts list <span className="text-gray-400 font-normal">({parts.length})</span>
          </h3>
          {parts.length === 0 ? (
            <p className="text-xs text-gray-400">No parts added yet.</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {parts.map((p, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded px-2 py-1">
                  <span className="text-xs text-gray-700 truncate">
                    {p.name || CATEGORY_LABELS[p.category]} <span className="text-gray-400">×{p.quantity}</span>
                  </span>
                  <button onClick={() => removePart(i)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Mission time (hours)</label>
          <input type="number" value={missionHours} onChange={e => setMissionHours(e.target.value)}
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
      <div className="flex-1 overflow-hidden flex flex-col">
        {result ? (
          <div className="flex-1 overflow-y-auto p-6">
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
                <p className="text-xs text-gray-500">Standard / environment</p>
                <p className="text-sm font-semibold text-gray-900">{result.standard}<br />{result.environment}</p>
              </div>
            </div>

            {/* Per-part breakdown */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Part Breakdown</h3>
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Part</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Category</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Qty</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">λ each (FPMH)</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">λ total (FPMH)</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Contribution</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">π factors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 font-medium">{r.name}</td>
                        <td className="px-3 py-1.5 text-gray-500">{CATEGORY_LABELS[r.category] ?? r.category}</td>
                        <td className="px-3 py-1.5 text-right">{r.quantity}</td>
                        <td className="px-3 py-1.5 text-right">{r.failure_rate.toFixed(5)}</td>
                        <td className="px-3 py-1.5 text-right">{r.total_failure_rate.toFixed(5)}</td>
                        <td className="px-3 py-1.5 text-right">{(r.contribution * 100).toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-gray-500 font-mono">
                          {Object.entries(r.pi_factors).map(([k, v]) => `${k}=${v}`).join('  ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                      xaxis: { title: 'Time (hours)', gridcolor: '#e5e7eb' },
                      yaxis: { title: 'Reliability R(t)', range: [0, 1.02], gridcolor: '#e5e7eb' },
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

            <p className="text-xs text-gray-400 mt-4">
              Part stress method per MIL-HDBK-217F Notice 2. VITA-51.1 mode applies
              representative COTS quality-factor adjustments per ANSI/VITA 51.1 —
              verify against the licensed standard for formal deliverables.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-lg font-medium">Failure Rate Prediction</p>
              <p className="text-sm mt-1">Build a parts list and click Predict (MIL-HDBK-217F / VITA 51.1)</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
