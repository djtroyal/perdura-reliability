import { useSyncExternalStore } from 'react'

export interface CapturedAsset {
  id: string
  label: string
  type: 'plot' | 'table'
  plotData?: unknown[]
  plotLayout?: unknown
  tableHeaders?: string[]
  tableRows?: (string | number)[][]
  capturedAt: number
}

let assets: CapturedAsset[] = []
const listeners = new Set<() => void>()
function notify() { listeners.forEach(l => l()) }

let seq = 0
function newId() { return `ra_${Date.now().toString(36)}_${(seq++).toString(36)}` }

export function addCapturedAsset(a: Omit<CapturedAsset, 'id' | 'capturedAt'>): string {
  const asset: CapturedAsset = { ...a, id: newId(), capturedAt: Date.now() }
  assets = [...assets, asset]
  notify()
  return asset.id
}

export function removeCapturedAsset(id: string) {
  assets = assets.filter(a => a.id !== id)
  notify()
}

export function clearCapturedAssets() {
  assets = []
  notify()
}

export function getCapturedAssets(): CapturedAsset[] { return assets }

export function useCapturedAssets(): CapturedAsset[] {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => assets,
  )
}
