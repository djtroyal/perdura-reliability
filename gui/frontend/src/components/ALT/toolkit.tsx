// Shared primitives for the Reliability Testing tool components.
//
// The genuinely shared pieces (style constants, Card, formatters, tab bars) now
// live in components/shared/* — this file re-exports them for back-compat and
// keeps the few ALT-flavoured helpers (Field/Select/ToolLayout).
import { Play } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import { inputCls, labelCls, btnCls } from '../shared/styles'
import { fmtNum } from '../shared/format'
import { Card, Tabs as ToolTabs } from '../shared/ui'
import type { ToolDef } from '../shared/ui'
import NumberField from '../shared/NumberField'

export { inputCls, labelCls, btnCls, fmtNum, Card, ToolTabs }
export type { ToolDef }

export const PLOT_CFG = { responsive: true, displayModeBar: true } as const
export const plotBase = {
  margin: { t: 30, r: 20, b: 45, l: 55 },
  paper_bgcolor: 'white', plot_bgcolor: 'white',
}

export function detail(e: unknown, fb: string): string {
  const apiDetail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  if (apiDetail) return apiDetail
  if (e instanceof Error && e.message) return e.message
  return fb
}

export function Field({ label, tip, value, onChange, type = 'number', step, min, max }: {
  label: string; tip?: string; value: string; onChange: (v: string) => void; type?: string
  step?: number; min?: number; max?: number
}) {
  return (
    <div>
      {tip ? <InfoLabel tip={tip}>{label}</InfoLabel> : <label className={labelCls}>{label}</label>}
      {type === 'number' ? (
        <NumberField value={value} onChange={onChange} semantic={label}
          step={step} min={min} max={max} className={inputCls} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} className={inputCls} />
      )}
    </div>
  )
}

export function Select({ label, tip, value, onChange, options }: {
  label: string; tip?: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      {tip ? <InfoLabel tip={tip}>{label}</InfoLabel> : <label className={labelCls}>{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function ToolLayout({ intro, controls, err, loading, onRun, runLabel, results }: {
  intro: string; controls: React.ReactNode; err: string | null; loading: boolean
  onRun: () => void; runLabel: string; results: React.ReactNode
}) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <p className="text-xs text-gray-500 leading-snug">{intro}</p>
        {controls}
        {err && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{err}</p>}
        <button onClick={onRun} disabled={loading} className={btnCls}><Play size={12} /> {loading ? 'Working...' : runLabel}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {results ?? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Enter inputs and click {runLabel}.
          </div>
        )}
      </div>
    </div>
  )
}
