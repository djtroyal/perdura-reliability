import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, ChevronDown, Image, Table2, Gauge, X } from 'lucide-react'
import { enumerateAssets } from '../../store/assetExtractors'
import {
  clearBookmarkNavigation, useBookmarkNavigationTarget, useBookmarks,
  resolveAssetDescriptor,
} from '../../store/bookmarks'
import { useStoreVersion } from '../../store/project'
import type { AssetDescriptor, AssetSource } from '../../store/reportAssets'
import { toast } from './toast'

const iconFor = (type: AssetDescriptor['type']) =>
  type === 'plot' ? Image : type === 'table' ? Table2 : Gauge

export function BookmarkAssetButton({
  asset, className = '', showLabel = false,
}: {
  asset: AssetDescriptor
  className?: string
  showLabel?: boolean
}) {
  const { toggle, isBookmarked } = useBookmarks()
  const resolved = resolveAssetDescriptor(asset)
  const active = isBookmarked(resolved.id)
  return (
    <button
      type="button"
      aria-label={`${active ? 'Remove bookmark for' : 'Bookmark'} ${asset.label}`}
      aria-pressed={active}
      title={active ? 'Remove bookmark' : 'Bookmark this result'}
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        toggle(resolved)
      }}
      className={`inline-flex items-center gap-1 rounded p-1 transition-colors ${
        active
          ? 'text-amber-600 hover:bg-amber-50'
          : 'text-gray-300 hover:bg-amber-50 hover:text-amber-600'
      } ${className}`}
    >
      <Bookmark size={13} fill={active ? 'currentColor' : 'none'} />
      {showLabel && <span>{active ? 'Bookmarked' : 'Bookmark'}</span>}
    </button>
  )
}

/** Contextual access to every Report Builder asset in the current module. */
export function ModuleBookmarkMenu({
  activeTab, activeModuleKey,
}: {
  activeTab: string
  activeModuleKey: string
}) {
  const storeVersion = useStoreVersion()
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const { isBookmarked, toggle } = useBookmarks()
  const assets = useMemo(() => enumerateAssets().filter(asset =>
    asset.source?.tab === activeTab),
  // Store version subscription above invalidates this render; these primitives
  // keep the memo focused on navigation context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [activeTab, activeModuleKey, storeVersion])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (activeTab === 'dashboard' || activeTab === 'report-builder') return null
  return (
    <div className="relative" ref={panel}>
      <button type="button" onClick={() => setOpen(value => !value)}
        title="Bookmark analysis results"
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-500 hover:border-amber-300 hover:text-amber-700">
        <Bookmark size={13} /> Results <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="text-xs font-semibold text-gray-700">Bookmark results</p>
            <p className="text-[10px] text-gray-400">The same assets available to Report Builder.</p>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {assets.length === 0 ? (
              <p className="px-2 py-4 text-center text-[11px] text-gray-400">Run an analysis to create bookmarkable results.</p>
            ) : assets.map(asset => {
              const Icon = iconFor(asset.type)
              const active = isBookmarked(asset.id)
              return (
                <button key={asset.id} type="button" onClick={() => toggle(asset)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${
                    active ? 'bg-amber-50 text-amber-900' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  <Icon size={12} className="flex-shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{asset.label}</span>
                    <span className="block truncate text-[9px] text-gray-400">{asset.group}</span>
                  </span>
                  <Bookmark size={12} fill={active ? 'currentColor' : 'none'}
                    className={active ? 'text-amber-600' : 'text-gray-300'} />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Completes deep-link navigation after the destination module has mounted. */
export function BookmarkFocusManager() {
  const target = useBookmarkNavigationTarget()
  useEffect(() => {
    if (!target) return
    let attempts = 0
    const maximumAttempts = 60
    const timer = window.setInterval(() => {
      attempts += 1
      let element = [...document.querySelectorAll<HTMLElement>('[data-report-asset-key]')]
        .find(candidate => candidate.dataset.reportAssetKey === target.source.assetKey)
      // Tables and metric summaries predate the shared plot wrapper. Their
      // visible section heading is a safe secondary anchor until each native
      // result surface has mounted after folio/sub-tab restoration.
      if (!element && attempts >= 20) {
        const wanted = target.label.trim().toLocaleLowerCase()
        element = [...document.querySelectorAll<HTMLElement>(
          'h1, h2, h3, h4, h5, [role="heading"], caption',
        )].find(candidate =>
          candidate.offsetParent !== null
          && candidate.textContent?.trim().toLocaleLowerCase() === wanted)
      }
      if (element) {
        window.clearInterval(timer)
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        element.classList.add('bookmark-target-highlight')
        window.setTimeout(() => element.classList.remove('bookmark-target-highlight'), 2200)
        clearBookmarkNavigation(target.nonce)
      } else if (attempts >= maximumAttempts) {
        window.clearInterval(timer)
        toast.info(`Opened ${target.source.analysisName}; “${target.label}” is not currently visible.`)
        clearBookmarkNavigation(target.nonce)
      }
    }, 50)
    return () => window.clearInterval(timer)
  }, [target])
  return null
}

export interface BookmarkOpenRequest { source: AssetSource; label: string }

export function RemoveBookmarkButton({ assetKey }: { assetKey: string }) {
  const { remove } = useBookmarks()
  return (
    <button type="button" onClick={event => {
      event.preventDefault()
      event.stopPropagation()
      remove(assetKey)
    }} title="Remove bookmark" aria-label="Remove bookmark"
      className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500">
      <X size={13} />
    </button>
  )
}
