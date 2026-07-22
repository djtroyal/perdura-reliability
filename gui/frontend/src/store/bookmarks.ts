import { useCallback, useSyncExternalStore } from 'react'
import { enumerateAssets } from './assetExtractors'
import { NAV_MAP, useModuleState } from './project'
import type { AssetDescriptor, AssetSource, AssetType } from './reportAssets'

export interface AssetBookmark {
  assetKey: string
  module: string
  moduleLabel: string
  group: string
  label: string
  type: AssetType
  source: AssetSource
  createdAt: string
}

export interface BookmarkState { items: AssetBookmark[] }
const EMPTY: BookmarkState = { items: [] }

function usableItems(value: unknown): AssetBookmark[] {
  if (!value || typeof value !== 'object') return []
  const items = (value as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  return items.filter((item): item is AssetBookmark => !!item
    && typeof item === 'object'
    && typeof (item as AssetBookmark).assetKey === 'string'
    && typeof (item as AssetBookmark).label === 'string'
    && typeof (item as AssetBookmark).source?.tab === 'string')
}

export function resolveAssetDescriptor(candidate: AssetDescriptor): AssetDescriptor {
  if (candidate.source?.assetKey === candidate.id) return candidate
  const assets = enumerateAssets()
  return assets.find(asset => asset.id === candidate.id)
    ?? assets.find(asset => asset.moduleLabel === candidate.moduleLabel
      && asset.group === candidate.group
      && asset.type === candidate.type
      && asset.label === candidate.label)
    ?? candidate
}

function sourceFor(asset: AssetDescriptor): AssetSource {
  if (asset.source) return asset.source
  const location = NAV_MAP[asset.module] ?? { tab: 'dashboard' }
  return {
    module: asset.module,
    tab: location.tab,
    sub: location.sub,
    analysisName: asset.group,
    assetKey: asset.id,
  }
}

export function bookmarkFromAsset(
  candidate: AssetDescriptor,
  createdAt = new Date().toISOString(),
): AssetBookmark {
  const asset = resolveAssetDescriptor(candidate)
  const source = sourceFor(asset)
  return {
    assetKey: asset.id,
    module: asset.module,
    moduleLabel: asset.moduleLabel,
    group: asset.group,
    label: asset.label,
    type: asset.type,
    source: { ...source, assetKey: asset.id },
    createdAt,
  }
}

export function useBookmarks() {
  const [raw, setRaw] = useModuleState<BookmarkState>('bookmarks', EMPTY)
  const items = usableItems(raw)
  const isBookmarked = useCallback(
    (assetKey: string) => items.some(item => item.assetKey === assetKey),
    [items],
  )
  const add = useCallback((candidate: AssetDescriptor) => {
    const bookmark = bookmarkFromAsset(candidate)
    setRaw(previous => {
      const current = usableItems(previous)
      if (current.some(item => item.assetKey === bookmark.assetKey)) return previous
      return { items: [bookmark, ...current] }
    })
  }, [setRaw])
  const remove = useCallback((assetKey: string) => {
    setRaw(previous => ({
      items: usableItems(previous).filter(item => item.assetKey !== assetKey),
    }))
  }, [setRaw])
  const toggle = useCallback((asset: AssetDescriptor) => {
    if (items.some(item => item.assetKey === asset.id)) remove(asset.id)
    else add(asset)
  }, [add, items, remove])
  return { items, add, remove, toggle, isBookmarked }
}

export interface BookmarkNavigationTarget {
  source: AssetSource
  label: string
  nonce: number
}

let navigation: BookmarkNavigationTarget | null = null
let navigationSequence = 0
const navigationListeners = new Set<() => void>()
const notifyNavigation = () => navigationListeners.forEach(listener => listener())

export function requestBookmarkNavigation(source: AssetSource, label: string) {
  navigation = { source, label, nonce: ++navigationSequence }
  notifyNavigation()
}

export function getBookmarkNavigationTarget(): BookmarkNavigationTarget | null {
  return navigation
}

export function clearBookmarkNavigation(nonce?: number) {
  if (nonce != null && navigation?.nonce !== nonce) return
  navigation = null
  notifyNavigation()
}

export function useBookmarkNavigationTarget(): BookmarkNavigationTarget | null {
  return useSyncExternalStore(
    listener => {
      navigationListeners.add(listener)
      return () => navigationListeners.delete(listener)
    },
    () => navigation,
  )
}
