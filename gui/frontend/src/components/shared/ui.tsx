/**
 * Shared presentational primitives reused across modules: the stat `Card`, and
 * tab bars (`TabBar` controlled + `Tabs` uncontrolled). Previously the Card was
 * redefined in ~9 modules and tab bars hand-rolled in ~14.
 */
import { useState } from 'react'

export function Card({ label, value, accent, tip }: {
  label: string; value: string; accent?: boolean; tip?: string
}) {
  return (
    <div title={tip} className={`rounded-lg border p-3 ${accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

export interface TabItem { id: string; label: string }

/** Controlled horizontal tab bar (caller owns the active id). */
export function TabBar({ tabs, active, onChange }: {
  tabs: TabItem[]; active: string; onChange: (id: string) => void
}) {
  return (
    <div className="flex items-stretch gap-1 bg-gray-50 border-b border-gray-200 px-3 overflow-x-auto">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
            active === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>{t.label}</button>
      ))}
    </div>
  )
}

export interface ToolDef { id: string; label: string; render: () => React.ReactNode }

/** Uncontrolled tab container: a TabBar plus the active tool's rendered body. */
export function Tabs({ tools, initial }: { tools: ToolDef[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tools[0]?.id)
  const current = tools.find(t => t.id === active) ?? tools[0]
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TabBar tabs={tools} active={active} onChange={setActive} />
      {current?.render()}
    </div>
  )
}
