import { useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import type { FoliosApi } from '../../store/project'
import { useShortcuts } from './KeyboardShortcuts'
import { handleTabKey } from './tabKeyboard'
import { useBookmarkNavigationTarget } from '../../store/bookmarks'

/**
 * Sub-tab bar for a module's folios (independent analyses). Double-click a
 * tab to rename; the × or a middle-click removes it (with a confirm). The
 * active tab is highlighted.
 */
export default function FolioBar({ api, label = 'Analysis' }: { api: FoliosApi; label?: string }) {
  const bookmarkTarget = useBookmarkNavigationTarget()
  const appliedBookmark = useRef(0)
  const toolbar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!bookmarkTarget || bookmarkTarget.nonce === appliedBookmark.current) return
    const { source } = bookmarkTarget
    if (source.module !== api.moduleKey || !source.analysisId) return
    if (!api.folios.some(folio => folio.id === source.analysisId)) return
    appliedBookmark.current = bookmarkTarget.nonce
    if (api.activeId !== source.analysisId) api.select(source.analysisId)
  }, [api, bookmarkTarget])
  const close = (id: string, name: string) => {
    const msg = api.folios.length <= 1
      ? `Close ${label.toLowerCase()} "${name}"? Its data will be removed and a new blank ${label.toLowerCase()} created.`
      : `Close ${label.toLowerCase()} "${name}"? Its data will be removed.`
    if (window.confirm(msg)) {
      api.remove(id)
      requestAnimationFrame(() => toolbar.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus())
    }
  }

  const rename = (id: string, currentName: string) => {
    const name = window.prompt(`Rename ${label.toLowerCase()}:`, currentName)
    if (name && name.trim()) api.rename(id, name.trim())
  }
  const activeIndex = Math.max(0, api.folios.findIndex(folio => folio.id === api.activeId))
  const selectOffset = (offset: number) => {
    if (!api.folios.length) return
    api.select(api.folios[(activeIndex + offset + api.folios.length) % api.folios.length].id)
  }
  const activeFolio = api.folios[activeIndex]
  useShortcuts([
    {
      id: `analysis.new.${label}`, label: `New ${label.toLowerCase()}`, category: 'Analysis',
      description: `Create a new ${label.toLowerCase()} in this module.`,
      bindings: [{ key: 'n', alt: true }], scope: 'module', handler: api.add,
    },
    {
      id: `analysis.previous.${label}`, label: `Previous ${label.toLowerCase()}`, category: 'Analysis',
      bindings: [{ code: 'BracketLeft', alt: true }], scope: 'module',
      enabled: api.folios.length > 1, disabledReason: `Only one ${label.toLowerCase()} is open.`,
      handler: () => selectOffset(-1),
    },
    {
      id: `analysis.next.${label}`, label: `Next ${label.toLowerCase()}`, category: 'Analysis',
      bindings: [{ code: 'BracketRight', alt: true }], scope: 'module',
      enabled: api.folios.length > 1, disabledReason: `Only one ${label.toLowerCase()} is open.`,
      handler: () => selectOffset(1),
    },
    {
      id: `analysis.rename.${label}`, label: `Rename current ${label.toLowerCase()}`, category: 'Analysis',
      scope: 'module', enabled: Boolean(activeFolio),
      handler: () => activeFolio && rename(activeFolio.id, activeFolio.name),
    },
    {
      id: `analysis.close.${label}`, label: `Close current ${label.toLowerCase()}`, category: 'Analysis',
      scope: 'module', enabled: Boolean(activeFolio),
      handler: () => activeFolio && close(activeFolio.id, activeFolio.name),
    },
  ])

  return (
    <div ref={toolbar} role="toolbar" aria-label={`${label} selection`} className="flex items-stretch gap-1 bg-gray-100 border-b border-gray-200 px-2 pt-1.5 overflow-x-auto flex-shrink-0">
      {api.folios.map(f => {
        const isActive = f.id === api.activeId
        return (
          <div key={f.id} className={`group flex items-center rounded-t border border-b-0 ${isActive ? 'bg-white border-gray-200' : 'bg-gray-50 border-transparent'}`}>
            <button type="button" onClick={() => api.select(f.id)}
              aria-pressed={isActive} data-tab-id={f.id}
              onKeyDown={event => handleTabKey(event, {
                ids: api.folios.map(folio => folio.id), currentId: f.id, onSelect: api.select,
                onRename: () => rename(f.id, f.name), onClose: () => close(f.id, f.name),
              })}
              onMouseDown={event => { if (event.button === 1) event.preventDefault() }}
              onAuxClick={event => {
                if (event.button !== 1) return
                event.preventDefault(); close(f.id, f.name)
              }}
              onDoubleClick={() => rename(f.id, f.name)}
              title="Switch analysis · double-click or F2 to rename · Delete or middle-click to close"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs whitespace-nowrap ${isActive ? 'text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-200/60'}`}>
              {f.name}
              {f.dirty && <span className="perdura-status-warning rounded px-1 text-xs" title="Inputs changed since the last calculation">Recalculate</span>}
            </button>
            <button type="button" onClick={() => close(f.id, f.name)}
              className="perdura-icon-button mr-1 text-gray-600 hover:text-red-700"
              aria-label={`Close ${label.toLowerCase()} ${f.name}`}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )
      })}
      <button type="button" onClick={() => {
        api.add()
        requestAnimationFrame(() => toolbar.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus())
      }} aria-label={`New ${label.toLowerCase()}`}
        className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:text-blue-700 self-end mb-px">
        <Plus size={14} aria-hidden="true" /> New
      </button>
    </div>
  )
}
