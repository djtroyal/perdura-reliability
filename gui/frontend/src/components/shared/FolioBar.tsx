import { Plus, X } from 'lucide-react'
import type { FoliosApi } from '../../store/project'

/**
 * Sub-tab bar for a module's folios (independent analyses). Double-click a
 * tab to rename; the × removes it (with a confirm). The active tab is
 * highlighted.
 */
export default function FolioBar({ api, label = 'Analysis' }: { api: FoliosApi; label?: string }) {
  return (
    <div className="flex items-stretch gap-1 bg-gray-100 border-b border-gray-200 px-2 pt-1.5 overflow-x-auto flex-shrink-0">
      {api.folios.map(f => {
        const isActive = f.id === api.activeId
        return (
          <div
            key={f.id}
            onClick={() => api.select(f.id)}
            onDoubleClick={() => {
              const name = window.prompt('Rename folio:', f.name)
              if (name && name.trim()) api.rename(f.id, name.trim())
            }}
            title={f.dirty
              ? 'Inputs changed since results were last computed — recalculate to refresh'
              : 'Click to switch · double-click to rename'}
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
                const msg = api.folios.length <= 1
                  ? `Close folio "${f.name}"? Its data will be removed and a new blank folio created.`
                  : `Close folio "${f.name}"? Its data will be removed.`
                if (window.confirm(msg)) api.remove(f.id)
              }}
              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Close folio"
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
