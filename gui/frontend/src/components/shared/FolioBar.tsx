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
    if (window.confirm(msg)) api.remove(id)
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
    <div role="tablist" aria-label={`${label} tabs`} className="flex items-stretch gap-1 bg-gray-100 border-b border-gray-200 px-2 pt-1.5 overflow-x-auto flex-shrink-0">
      {api.folios.map(f => {
        const isActive = f.id === api.activeId
        return (
          <div
            key={f.id}
            onClick={() => api.select(f.id)}
            onKeyDown={event => handleTabKey(event, {
              ids: api.folios.map(folio => folio.id),
              currentId: f.id,
              onSelect: api.select,
              onRename: id => {
                const folio = api.folios.find(item => item.id === id)
                if (folio) rename(folio.id, folio.name)
              },
              onClose: id => {
                const folio = api.folios.find(item => item.id === id)
                if (folio) close(folio.id, folio.name)
              },
            })}
            onMouseDown={event => {
              if (event.button === 1) event.preventDefault()
            }}
            onAuxClick={event => {
              if (event.button !== 1) return
              event.preventDefault()
              event.stopPropagation()
              close(f.id, f.name)
            }}
            onDoubleClick={() => rename(f.id, f.name)}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            data-tab-id={f.id}
            title={f.dirty
              ? 'Inputs changed since results were last computed — recalculate to refresh · middle-click to close'
              : 'Click to switch · double-click to rename · middle-click to close'}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t cursor-pointer whitespace-nowrap border border-b-0 transition-colors ${
              isActive
                ? 'bg-white border-gray-200 text-blue-700 font-medium'
                : 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-200/60'
            }`}
          >
            <span>
              {f.name}
              {f.dirty && (
                <span className="text-amber-500 font-bold" title="Unsaved changes — recalculate results">&nbsp;*</span>
              )}
            </span>
            <button
              onClick={e => {
                e.stopPropagation()
                close(f.id, f.name)
              }}
              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              title={`Close ${label.toLowerCase()}`}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      <button
        onClick={api.add}
        title={`New ${label.toLowerCase()}`}
        className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-blue-600 self-end mb-px"
      >
        <Plus size={13} /> New
      </button>
    </div>
  )
}
