import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// Main modules are unmounted when the user changes the top-level module tab.
// Keep navigation-only state outside the project model so returning to a module
// restores its last submodule without dirtying the project or retaining every
// heavyweight module tree in the DOM.
const rememberedTabs = new Map<string, string>()

export function readRememberedTab<T extends string>(
  key: string,
  fallback: T,
  validTabs: readonly T[],
): T {
  const remembered = rememberedTabs.get(key)
  return remembered != null && validTabs.includes(remembered as T)
    ? remembered as T
    : fallback
}

export function rememberTab(key: string, tab: string): void {
  rememberedTabs.set(key, tab)
}

export function clearRememberedTabs(): void {
  rememberedTabs.clear()
}

/** Remember a module's active navigation tab for this application session. */
export function useRememberedTab<T extends string>(
  key: string | null,
  fallback: T,
  validTabs: readonly T[],
): [T, Dispatch<SetStateAction<T>>] {
  const [active, setActiveState] = useState<T>(() => key == null
    ? fallback
    : readRememberedTab(key, fallback, validTabs))

  const setActive = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setActiveState(current => {
      const resolved = typeof next === 'function'
        ? (next as (previous: T) => T)(current)
        : next
      if (key != null) rememberTab(key, resolved)
      return resolved
    })
  }, [key])

  return [active, setActive]
}
