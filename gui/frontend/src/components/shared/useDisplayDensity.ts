import { useEffect, useState } from 'react'

export type DisplayDensity = 'compact' | 'comfortable'
const KEY = 'perdura.ui.density'
const normalize = (value: string | null): DisplayDensity => value === 'comfortable' ? 'comfortable' : 'compact'

/** Browser display preference; never changes scientific project inputs. */
export function useDisplayDensity() {
  const [density, setDensity] = useState<DisplayDensity>(() => {
    try { return normalize(localStorage.getItem(KEY)) } catch { return 'compact' }
  })
  useEffect(() => {
    document.documentElement.dataset.density = density
    try { localStorage.setItem(KEY, density) } catch { /* Session preference remains usable. */ }
  }, [density])
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === KEY) setDensity(normalize(event.newValue)) }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  return [density, setDensity] as const
}
