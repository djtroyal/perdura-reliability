/**
 * Shared presentational primitives reused across modules: the stat `Card`, and
 * tab bars (`TabBar` controlled + `Tabs` uncontrolled). Previously the Card was
 * redefined in ~9 modules and tab bars hand-rolled in ~14.
 */
import { useApplySubNav, SubNav } from './useSubNav'
import { useRememberedTab } from './useRememberedTab'
import { useHelpTopic } from '../help/context'
import { handleTabKey } from './tabKeyboard'

export type CardTone = 'module' | 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export function Card({ label, value, accent, tone, tip, onClick, active }: {
  label: string; value: string; accent?: boolean; tip?: string
  tone?: CardTone
  /** When set, the card is a toggle button (e.g. dashboard KPI drill-down). */
  onClick?: () => void
  active?: boolean
}) {
  const resolvedTone = tone ?? (accent ? 'module' : 'neutral')
  const body = (
    <>
      <p className="module-stat-label text-xs">{label}</p>
      <p className="module-stat-value text-lg font-semibold">{value}</p>
    </>
  )
  if (!onClick) {
    return <div title={tip} data-tone={resolvedTone}
      className="module-stat-card rounded-lg border p-3">{body}</div>
  }
  return (
    <button
      title={tip}
      onClick={onClick}
      aria-expanded={active}
      data-tone={resolvedTone}
      data-active={active ? 'true' : 'false'}
      className="module-stat-card rounded-lg border p-3 text-left transition-colors"
    >
      {body}
    </button>
  )
}

export interface TabItem { id: string; label: string }

/** Controlled horizontal tab bar (caller owns the active id). */
export function TabBar({ tabs, active, onChange }: {
  tabs: TabItem[]; active: string; onChange: (id: string) => void
}) {
  return (
    <div role="tablist" aria-label="Submodule tabs" className="module-tab-bar flex items-stretch gap-1 border-b px-3 overflow-x-auto">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          role="tab" aria-selected={active === t.id} tabIndex={active === t.id ? 0 : -1}
          data-tab-id={t.id}
          data-active={active === t.id ? 'true' : 'false'}
          onKeyDown={event => handleTabKey(event, {
            ids: tabs.map(tab => tab.id), currentId: t.id, onSelect: onChange,
          })}
          className="module-subtab px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors"
        >{t.label}</button>
      ))}
    </div>
  )
}

export interface ToolDef { id: string; label: string; render: () => React.ReactNode }

/** Tab container that can be uncontrolled or project-state controlled. */
export function Tabs({ tools, initial, navSub, active: controlledActive, onActiveChange, helpTopicPrefix, rememberKey }: {
  tools: ToolDef[]
  rememberKey?: string
  initial?: string
  navSub?: SubNav | null
  active?: string
  onActiveChange?: (id: string) => void
  helpTopicPrefix?: string
}) {
  const validTabs = tools.map(tool => tool.id)
  const [localActive, setLocalActive] = useRememberedTab(
    rememberKey ?? null, initial ?? tools[0]?.id ?? '', validTabs,
  )
  const active = controlledActive ?? localActive
  useHelpTopic(helpTopicPrefix && active ? `${helpTopicPrefix}.${active}` : null, 10)
  const setActive = (id: string) => {
    if (controlledActive === undefined) setLocalActive(id)
    onActiveChange?.(id)
  }
  useApplySubNav(navSub, s => { if (tools.some(t => t.id === s)) setActive(s) })
  const current = tools.find(t => t.id === active) ?? tools[0]
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TabBar tabs={tools} active={active} onChange={setActive} />
      {current?.render()}
    </div>
  )
}
