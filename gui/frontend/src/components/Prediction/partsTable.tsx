import { memo } from 'react'
import {
  Cpu, CircuitBoard, Triangle, Zap, Lightbulb, MonitorSpeaker, Activity,
  RectangleHorizontal, Battery, Magnet, ToggleRight, ToggleLeft, Shield, Plug,
  Cable, Fan, Gauge, Diamond, Filter, Disc, Box, AlertTriangle, StickyNote, Trash2,
} from 'lucide-react'
import { PredictionPart, PredictionResult } from '../../api/client'
import { NO_ENV_CATEGORIES, VITA_CATEGORIES } from './constants'

// Icon + accent color per component category, shown in the Parts List.
const CATEGORY_ICONS: Record<string, { Icon: typeof Cpu; color: string }> = {
  microcircuit: { Icon: Cpu, color: 'text-indigo-500' },
  vhsic_microcircuit: { Icon: Cpu, color: 'text-indigo-600' },
  detailed_cmos: { Icon: Cpu, color: 'text-violet-600' },
  gaas_microcircuit: { Icon: Cpu, color: 'text-violet-500' },
  hybrid_microcircuit: { Icon: CircuitBoard, color: 'text-indigo-600' },
  saw_device: { Icon: Activity, color: 'text-indigo-400' },
  bubble_memory: { Icon: Cpu, color: 'text-violet-400' },
  diode: { Icon: Triangle, color: 'text-rose-500' },
  hf_diode: { Icon: Triangle, color: 'text-rose-400' },
  bjt: { Icon: CircuitBoard, color: 'text-emerald-500' },
  fet: { Icon: CircuitBoard, color: 'text-teal-500' },
  gaas_fet: { Icon: CircuitBoard, color: 'text-teal-400' },
  unijunction: { Icon: CircuitBoard, color: 'text-emerald-400' },
  hf_low_noise_bjt: { Icon: CircuitBoard, color: 'text-emerald-600' },
  hf_power_bjt: { Icon: CircuitBoard, color: 'text-emerald-700' },
  hf_silicon_fet: { Icon: CircuitBoard, color: 'text-teal-600' },
  thyristor: { Icon: Zap, color: 'text-amber-500' },
  optoelectronic: { Icon: Lightbulb, color: 'text-yellow-500' },
  laser_diode: { Icon: Activity, color: 'text-red-400' },
  electron_tube: { Icon: MonitorSpeaker, color: 'text-orange-600' },
  traveling_wave_tube: { Icon: MonitorSpeaker, color: 'text-orange-500' },
  magnetron: { Icon: MonitorSpeaker, color: 'text-orange-700' },
  gas_laser: { Icon: Activity, color: 'text-red-400' },
  sealed_co2_laser: { Icon: Activity, color: 'text-red-500' },
  flowing_co2_laser: { Icon: Activity, color: 'text-red-600' },
  solid_state_laser: { Icon: Activity, color: 'text-red-700' },
  resistor: { Icon: RectangleHorizontal, color: 'text-orange-500' },
  capacitor: { Icon: Battery, color: 'text-sky-500' },
  transformer: { Icon: Magnet, color: 'text-purple-600' },
  inductor_coil: { Icon: Magnet, color: 'text-purple-500' },
  ferrite_bead: { Icon: Magnet, color: 'text-purple-400' },
  relay: { Icon: ToggleRight, color: 'text-cyan-500' },
  ss_relay: { Icon: ToggleRight, color: 'text-cyan-400' },
  switch: { Icon: ToggleLeft, color: 'text-blue-500' },
  circuit_breaker: { Icon: Shield, color: 'text-blue-600' },
  connector: { Icon: Plug, color: 'text-lime-600' },
  connector_socket: { Icon: Plug, color: 'text-lime-500' },
  pth_assembly: { Icon: CircuitBoard, color: 'text-emerald-600' },
  surface_mount_assembly: { Icon: CircuitBoard, color: 'text-emerald-500' },
  connection: { Icon: Cable, color: 'text-stone-500' },
  motor: { Icon: Fan, color: 'text-green-500' },
  synchro_resolver: { Icon: Fan, color: 'text-green-600' },
  elapsed_time_meter: { Icon: Gauge, color: 'text-slate-500' },
  meter: { Icon: Gauge, color: 'text-slate-500' },
  crystal: { Icon: Diamond, color: 'text-fuchsia-500' },
  oscillator: { Icon: Diamond, color: 'text-fuchsia-400' },
  mems_oscillator: { Icon: Cpu, color: 'text-violet-400' },
  lamp: { Icon: Lightbulb, color: 'text-amber-400' },
  filter: { Icon: Filter, color: 'text-violet-500' },
  fuse: { Icon: Zap, color: 'text-red-500' },
  miscellaneous: { Icon: Disc, color: 'text-gray-500' },
  parts_count: { Icon: CircuitBoard, color: 'text-slate-600' },
  custom: { Icon: Box, color: 'text-gray-400' },
  generic: { Icon: Box, color: 'text-gray-400' },
}

export function CategoryIcon({ category }: { category: string }) {
  const { Icon, color } = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.generic
  return <Icon size={13} className={`flex-shrink-0 ${color}`} />
}

const vitaLabel = (v: boolean | null | undefined, global: boolean) =>
  v == null ? (global ? 'Global (on)' : 'Global (off)') : v ? 'On' : 'Off'

const FACTOR_LABELS: Record<string, string> = {
  lambda_b: 'λb', lambda_cyc: 'λcyc', lambda_P: 'λP', lambda_C: 'λC',
  pi_T: 'πT', pi_P: 'πP', pi_S: 'πS', pi_Q: 'πQ', pi_E: 'πE',
  pi_C: 'πC', pi_V: 'πV', pi_SR: 'πSR', pi_L: 'πL', pi_A: 'πA',
  pi_K: 'πK', pi_M: 'πM', pi_F: 'πF', pi_R: 'πR',
}

const formatFactorValue = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value !== 'number') return value == null || value === '' ? '—' : String(value)
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute !== 0 && (absolute < 0.0001 || absolute >= 10000)) return value.toExponential(3)
  return Number(value.toPrecision(5)).toString()
}

/**
 * One part row of the parts/BOM table. Memoized so editing a single part (or
 * selecting/recomputing) only re-renders the affected rows — unchanged parts
 * keep their object reference and receive stable callbacks, so React.memo skips
 * them. Block rows stay inline (there are few of them). Extracted from index.tsx.
 */
const PartRow = memo(function PartRow({
  part, index, depth, resultRow, categoryLabel, inheritedEnv,
  vitaGlobal, showVita, selected, onSelect, onQty, onCycleVita, onRemove,
}: {
  part: PredictionPart
  index: number
  depth: number
  resultRow?: PredictionResult
  categoryLabel: string
  inheritedEnv: string
  vitaGlobal: boolean
  showVita: boolean
  selected: boolean
  onSelect: (idx: number) => void
  onQty: (idx: number, qty: string) => void
  onCycleVita: (idx: number) => void
  onRemove: (idx: number) => void
}) {
  const p = part
  const i = index
  const r = resultRow
  const incompatible = !!r?.incompatible
  const envDisplay = p.environment || inheritedEnv
  const envTitle = p.environment ? `Override: ${p.environment}` : `Inherited: ${inheritedEnv}`
  const factorText = r
    ? Object.entries(r.pi_factors)
      .map(([key, value]) => `${FACTOR_LABELS[key] ?? key}=${formatFactorValue(value)}`)
      .join('  ')
    : '—'
  return (
    <tr
      onClick={() => onSelect(i)}
      className={`border-t group cursor-pointer ${
        incompatible
          ? 'border-l-2 border-l-red-400 border-t-red-100 bg-red-50 hover:bg-red-100/70'
          : `border-gray-100 hover:bg-blue-50/50 ${selected ? 'bg-blue-50' : ''}`
      }`}>
      <td className="py-1.5 font-medium" style={{ paddingLeft: 12 + depth * 20 }}>
        <span className="inline-flex items-center gap-1.5">
          <CategoryIcon category={p.category} />
          <span>{p.name || `${categoryLabel} ${i + 1}`}</span>
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
          {p.failure_rate_override_enabled && (
            <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">
              override
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-1.5 text-gray-500">{categoryLabel}</td>
      <td className="px-1 py-1 text-right" onClick={e => e.stopPropagation()}>
        <input type="number" min={1} step={1} value={p.quantity}
          onChange={e => onQty(i, e.target.value)}
          className="w-14 text-xs text-right border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 py-0.5 focus:outline-none" />
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-gray-500">
        {Number(p.params.multiplier ?? 1)}
      </td>
      {showVita && (
        <td className="px-3 py-1.5 text-center">
          {!VITA_CATEGORIES.has(p.category) ? (
            <span className="text-gray-300">n/a</span>
          ) : (
            <button onClick={e => { e.stopPropagation(); onCycleVita(i) }}
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
            title={envTitle}>
            {envDisplay}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-right font-mono">
        {incompatible ? <span className="text-red-300">—</span> : r ? (
          <span title={r.override_applied
            ? `Handbook/duty-calculated: ${r.calculated_failure_rate?.toFixed(8)} FPMH`
            : undefined}>
            <span className={r.override_applied ? 'font-semibold text-amber-700' : ''}>
              {r.failure_rate.toFixed(5)}
            </span>
            {r.override_applied && r.calculated_failure_rate != null && (
              <span className="block text-[9px] text-gray-400">calc {r.calculated_failure_rate.toFixed(5)}</span>
            )}
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-1.5 text-right font-mono">{incompatible ? <span className="text-red-300">—</span> : r ? r.total_failure_rate.toFixed(5) : '—'}</td>
      <td className="px-3 py-1.5 text-right font-mono">{incompatible ? <span className="text-red-300">—</span> : r ? `${(r.contribution * 100).toFixed(1)}%` : '—'}</td>
      <td className="px-3 py-1.5 font-mono text-[10px]">
        {incompatible
          ? <span className="text-red-600">{r?.error || 'Not supported by the selected standard'}</span>
          : <span className="block max-w-72 truncate text-gray-500" title={factorText}>{factorText}</span>}
      </td>
      <td className="px-1 py-1.5 text-center">
        <button onClick={e => { e.stopPropagation(); onRemove(i) }}
          className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  )
})

export default PartRow
